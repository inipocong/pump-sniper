import WebSocket from "ws";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { Store } from "../db.js";
import { decodeCreateV2Transaction, RpcTransaction } from "../decoder/pumpCreateV2.js";
import { decodeMoonshotTransaction } from "../decoder/moonshotDecoder.js";
import { decodeGraduationTransaction } from "../decoder/graduationDecoder.js";
import { TokenCandidate } from "../types.js";
import { SolanaRpcClient } from "../risk/solanaRpc.js";
import { assessToken2022Risk } from "../risk/token2022Adapter.js";
import { getBondingCurveMetrics } from "../risk/bondingCurve.js";
import { analyzeCreator } from "../risk/creatorAnalysis.js";
import { auditManipulationRisk } from "../risk/manipulationFilter.js";
import { evaluateSniperStrategy, SniperDecision } from "../risk/sniperStrategy.js";
import { PaperTrader } from "../paper/paperTrader.js";
import { CtoReboundTracker } from "../risk/ctoTracker.js";
import { evaluateVolumeMetrics } from "../risk/volumeFilter.js";
import { resolveTokenPriceAndMetadata } from "../risk/tokenPriceResolver.js";

const MAX_CONCURRENT_POSITIONS = 3;
const MIN_CONFIDENCE_SCORE = 80;          // Diturunkan ke 80: skor 80-84 masuk radar dengan margin 0.010 SOL!
const EXPLORATORY_BUY_AMOUNT_SOL = 0.010; // Margin aman untuk radar in skor 80-84
const BASE_BUY_AMOUNT_SOL = 0.015;        // Margin normal untuk skor 85-89
const HIGH_CONVICTION_BUY_AMOUNT_SOL = 0.030; // Margin moon untuk skor >= 90 / CTO / Surge
const MIN_DEV_INITIAL_SOL = 0.5; // Batas minimal 0.5 SOL (~$88)

export class SolanaLogsFeed {
  private ws?: WebSocket;
  private nextId = 1;
  private stopped = false;
  private reconnect?: NodeJS.Timeout;
  private priceMonitorInterval?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;
  private rpc: SolanaRpcClient;
  private ctoTracker = new CtoReboundTracker();
  private preJeetCandidates = new Map<
    string,
    {
      mint: string;
      symbol: string;
      creator: string;
      bondingCurve: string;
      initialHoldingPct: number;
      initialPrice: number;
      initialSol: number;
      detectedAt: number;
    }
  >();

  constructor(
    private store: Store,
    private paperTrader?: PaperTrader
  ) {
    this.rpc = new SolanaRpcClient();
  }

  start(): void {
    if (!config.wsUrl || !config.rpcUrl || !config.pumpProgramId) {
      throw new Error("SOLANA_WS_URL, SOLANA_RPC_URL dan PUMP_PROGRAM_ID wajib diisi di .env");
    }
    this.connect();
    this.startPositionMonitor();
    this.startHeartbeat();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.priceMonitorInterval) clearInterval(this.priceMonitorInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.ws?.close();
  }

  private wsEndpoints = [
    config.wsUrl,
    "wss://api.mainnet-beta.solana.com",
    "wss://solana-rpc.publicnode.com",
  ].filter((v, i, a) => v && a.indexOf(v) === i);
  private currentWsIndex = 0;
  private reconnectDelay = 3000;

  private connect(): void {
    if (this.stopped) return;
    const currentUrl = this.wsEndpoints[this.currentWsIndex] || config.wsUrl;
    this.ws = new WebSocket(currentUrl);

    this.ws.on("open", () => {
      this.reconnectDelay = 3000;
      // 1. Subscribe ke Peluncuran Token Pump.fun
      this.ws?.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: this.nextId++,
          method: "logsSubscribe",
          params: [{ mentions: [config.pumpProgramId] }, { commitment: "confirmed" }],
        })
      );

      // 2. Subscribe ke Peluncuran Token Moonshot (DexScreener)
      if (config.moonshotProgramId) {
        this.ws?.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: this.nextId++,
            method: "logsSubscribe",
            params: [{ mentions: [config.moonshotProgramId] }, { commitment: "confirmed" }],
          })
        );
      }

      logger.info(
        `📡 [LOG LISTENER] Berhasil terhubung ke Solana WebSocket (${currentUrl}) & Memantau Peluncuran Koin Baru!`
      );
    });

    this.ws.on("message", raw => {
      void this.handle(raw.toString());
    });

    this.ws.on("error", (error: any) => {
      const errMsg = error?.message || error?.code || "Connection error";
      logger.error({ error: errMsg }, `WebSocket error (${currentUrl})`);
    });

    this.ws.on("close", () => {
      this.currentWsIndex = (this.currentWsIndex + 1) % this.wsEndpoints.length;
      const nextUrl = this.wsEndpoints[this.currentWsIndex];
      const waitSec = Math.round(this.reconnectDelay / 1000);
      logger.warn(`WebSocket terputus; berganti ke ${nextUrl} dan mencoba reconnect dalam ${waitSec} detik...`);
      if (!this.stopped) {
        this.reconnect = setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(Math.round(this.reconnectDelay * 1.5), 15000);
      }
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.stopped) return;
      const open = this.store.getOpenPaperTrades();
      if (this.paperTrader) {
        const summary = this.paperTrader.getPortfolioSummary();
        logger.info(
          `📡 [RADAR ON] Bot aktif memantau koin baru | Saldo Kas: ${summary.virtualBalanceSol} SOL | Portofolio: ${summary.totalPortfolioSol} SOL | Total Net PnL: ${summary.netPnlSign}${summary.totalPnlSol} SOL (${summary.winRate} WR | ${open.length}/3 slot aktif)`
        );
      } else if (open.length === 0) {
        logger.info("📡 [RADAR ON] Bot aktif memantau koin baru (Pump.fun, Moonshot, & Raydium Migration)...");
      }
    }, 20000);
  }

  private async handle(raw: string): Promise<void> {
    try {
      const msg = JSON.parse(raw);
      if (msg.method !== "logsNotification") return;

      const value = msg.params?.result?.value;
      const signature = value?.signature as string | undefined;
      if (!signature || value?.err) return;

      if (this.store.hasCandidate(signature)) return;

      const logs: string[] = value.logs ?? [];
      const isPump = logs.some(line => /Instruction:\s*CreateV2/i.test(line));
      const isMoonshot = logs.some(line => /Instruction:\s*(TokenMint|tokenMint)/i.test(line));
      const isGraduation = logs.some(line => /Instruction:\s*(Migrate|migrate|Initialize2)/i.test(line));

      // Abaikan jika bukan event penciptaan koin atau kelulusan Raydium
      if (!isPump && !isMoonshot && !isGraduation) return;

      const response = await fetch(config.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(3500), // Timeout 3.5s anti-hang!
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: this.nextId++,
          method: "getTransaction",
          params: [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
        }),
      });

      if (!response.ok) return;
      const payload = (await response.json()) as { result?: RpcTransaction | null; error?: unknown };
      if (payload.error || !payload.result) return;

      let platformName = "PUMP.FUN";
      let decodedCandidate: {
        mint: string;
        bondingCurve: string;
        creator: string;
        name: string;
        symbol: string;
        metadataUri: string;
      } | null = null;

      if (isPump) {
        platformName = "PUMP.FUN";
        decodedCandidate = decodeCreateV2Transaction(payload.result, signature, config.pumpProgramId);
      } else if (isMoonshot && config.moonshotProgramId) {
        platformName = "MOONSHOT";
        decodedCandidate = decodeMoonshotTransaction(payload.result, signature, config.moonshotProgramId);
      } else if (isGraduation) {
        platformName = "RAYDIUM GRADUATE";
        const grad = decodeGraduationTransaction(payload.result);
        if (grad) {
          const curve = this.store.getBondingCurveByMint(grad.mint) || grad.mint;
          decodedCandidate = {
            mint: grad.mint,
            bondingCurve: curve,
            creator: "Graduation Pool",
            name: "Graduated Token",
            symbol: "GRAD",
            metadataUri: "",
          };
        }
      }

      if (!decodedCandidate) return;

      const openPositions = this.store.getOpenPaperTrades();
      // Jangan beli lagi jika sudah ada posisi terbuka pada mint ini
      if (openPositions.some(p => p.mint === decodedCandidate!.mint)) return;

      const candidate: TokenCandidate = {
        signature,
        slot: msg.params?.result?.context?.slot,
        detectedAt: Date.now(),
        programId: isPump ? config.pumpProgramId : (isMoonshot ? (config.moonshotProgramId ?? "") : "RaydiumPool"),
        ...decodedCandidate,
        instruction: isPump ? "create_v2" : (isMoonshot ? "tokenMint" : "migrate"),
        source: isPump ? "solana_logs_pump" : (isMoonshot ? "solana_logs_moonshot" : "solana_logs_graduation"),
        status: "DECODED",
      };

      this.store.addCandidate(candidate);

      // 1. Eksekusi pengecekan Token Security & Bonding Curve secara PARALEL (Kecepatan Maksimal)
      const [{ assessment: tokenSecurity }, curveData] = await Promise.all([
        assessToken2022Risk(decodedCandidate.mint, signature, this.rpc),
        getBondingCurveMetrics(this.rpc, decodedCandidate.bondingCurve),
      ]);

      this.store.saveRiskAssessment(tokenSecurity);

      if (tokenSecurity.verdict !== "ALLOW") {
        logger.warn(
          { platform: platformName, mint: decodedCandidate.mint, symbol: decodedCandidate.symbol, verdict: tokenSecurity.verdict },
          `[RISK: REJECT] [${platformName}] Token terindikasi honeypot/tidak aman, dilewati.`
        );
        return;
      }

      if (!curveData) return;

      // Pantau koin yang dipegang dev (>=4%) untuk deteksi potensi Dev Jeet & CTO Rebound
      if (curveData.metrics.devHoldingPct >= 4.0) {
        this.preJeetCandidates.set(decodedCandidate.mint, {
          mint: decodedCandidate.mint,
          symbol: decodedCandidate.symbol,
          creator: decodedCandidate.creator,
          bondingCurve: decodedCandidate.bondingCurve,
          initialHoldingPct: curveData.metrics.devHoldingPct,
          initialPrice: curveData.metrics.priceInSol,
          initialSol: curveData.metrics.realSolCollected,
          detectedAt: Date.now(),
        });

        // Pertahankan maksimal 25 item di pre-jeet cache
        if (this.preJeetCandidates.size > 25) {
          const firstKey = this.preJeetCandidates.keys().next().value;
          if (firstKey) this.preJeetCandidates.delete(firstKey);
        }
      }

      // 2. FAST-FILTER EARLY EXIT:
      // Jika modal dev receh (< 0.5 SOL) atau dev serakah (> 12.5% supply) atau komitmen dev terlalu kecil (< 4.5%):
      // Langsung putuskan SKIP seketika dalam <100ms tanpa buang-buang kuota RPC untuk analisa creator/holder!
      const devHolding = curveData.metrics.devHoldingPct ?? 0;
      const solCollected = curveData.metrics.realSolCollected;
      const isReceh = !isGraduation && solCollected < MIN_DEV_INITIAL_SOL;
      const isSerakah = !isGraduation && devHolding > 12.5;
      const isMinim = !isGraduation && devHolding < 4.5;

      if (isReceh || isSerakah || isMinim) {
        const abortReasons: string[] = [];
        if (isReceh) {
          abortReasons.push(`Dev modal receh / tidak beli awal (Terkumpul: ${solCollected.toFixed(3)} SOL < minimal ${MIN_DEV_INITIAL_SOL} SOL)`);
        }
        if (isSerakah) {
          abortReasons.push(`Alokasi dev terlalu serakah (${devHolding.toFixed(2)}% > 12.5%) - risiko dev dump nuklir`);
        } else if (isMinim) {
          abortReasons.push(`Alokasi dev terlalu kecil (${devHolding.toFixed(2)}% < 4.5%) - dev minim komitmen; Skor keyakinan 70 di bawah ambang batas minimal (${MIN_CONFIDENCE_SCORE})`);
        }

        logger.info(
          {
            platform: platformName,
            mint: decodedCandidate.mint,
            symbol: decodedCandidate.symbol,
            confidenceScore: isReceh ? 0 : 70,
            abortReasons,
          },
          `[SNIPER: SKIP] [${platformName}] Koin tidak memenuhi kriteria (${abortReasons.join("; ")})`
        );
        return;
      }

      // 3. Jika lolos kriteria kurva awal, jalankan analisis Creator & Holder secara PARALEL
      const [creatorAnalysis, manipulationAnalysis] = await Promise.all([
        analyzeCreator(this.rpc, decodedCandidate.creator),
        auditManipulationRisk(this.rpc, decodedCandidate.mint, decodedCandidate.bondingCurve),
      ]);
      const volumeAnalysis = evaluateVolumeMetrics(curveData.metrics);

      const decision = evaluateSniperStrategy({
        tokenSecurity,
        creator: creatorAnalysis.profile,
        bondingCurve: curveData.metrics,
        manipulation: manipulationAnalysis,
        volume: volumeAnalysis.metrics,
        isGraduation,
        config: {
          minConfidenceScore: isGraduation ? 75 : MIN_CONFIDENCE_SCORE, // 80
          exploratoryBuyAmountSol: EXPLORATORY_BUY_AMOUNT_SOL, // 0.010
          baseBuyAmountSol: BASE_BUY_AMOUNT_SOL, // 0.015
          highConvictionBuyAmountSol: HIGH_CONVICTION_BUY_AMOUNT_SOL, // 0.030
          strictDevCheck: false,
          minDevInitialSol: isGraduation ? 0 : MIN_DEV_INITIAL_SOL, // 0.5 SOL
          minVolumeSol: isGraduation ? 0 : 0.60, // Minimal volume 0.60 SOL
        },
      });

      if (!decision.shouldSnipe) {
        logger.info(
          {
            platform: platformName,
            mint: decodedCandidate.mint,
            symbol: decodedCandidate.symbol,
            confidenceScore: decision.confidenceScore,
            abortReasons: decision.abortReasons,
          },
          `[SNIPER: SKIP] [${platformName}] Koin tidak memenuhi kriteria (${decision.abortReasons.join("; ")})`
        );
        return;
      }

      if (this.paperTrader) {
        // Cek apakah slot posisi terbuka sudah penuh (maksimal 3 posisi serentak)
        const openPositions = this.store.getOpenPaperTrades();
        if (openPositions.length >= MAX_CONCURRENT_POSITIONS) {
          logger.info(
            {
              platform: platformName,
              symbol: decodedCandidate.symbol,
              confidenceScore: decision.confidenceScore,
              slotsActive: openPositions.length,
            },
            `[SLOT PENUH 3/3] [${platformName}] ${decodedCandidate.symbol} lolos kriteria, namun semua ${MAX_CONCURRENT_POSITIONS} slot posisi sedang aktif.`
          );
          return;
        }

        let badge = "💎 [GEM STANDAR - 0.015 SOL]";
        let actionText = `Lolos filter standar (Skor: ${decision.confidenceScore}), beli alokasi normal: ${decision.recommendedBuySol} SOL`;

        if (decision.convictionLevel === "HIGH_CONVICTION") {
          badge = "🌕 [HIGH CONVICTION MOON GEM - 0.030 SOL]";
          actionText = `SIAP TERBANG TO THE MOON! Beli Alokasi Maksimal: ${decision.recommendedBuySol} SOL`;
        } else if (decision.convictionLevel === "EXPLORATORY") {
          badge = "🔭 [RADAR IN - 0.010 SOL]";
          actionText = `Masuk radar eksplorasi (Skor: ${decision.confidenceScore}), beli margin aman: ${decision.recommendedBuySol} SOL`;
        }

        logger.info(
          {
            platform: platformName,
            symbol: decodedCandidate.symbol,
            confidenceScore: decision.confidenceScore,
            devSol: curveData.metrics.realSolCollected,
            volumeSol: volumeAnalysis.metrics.totalSolVolume,
            volumeTier: volumeAnalysis.metrics.volumeTier,
            buyAmount: decision.recommendedBuySol,
            conviction: decision.convictionLevel,
            isHighConviction: decision.isHighConviction,
          },
          `${badge} [${platformName}] ${actionText} (Volume: ${curveData.metrics.realSolCollected.toFixed(2)} SOL | Tier: ${volumeAnalysis.metrics.volumeTier})`
        );
        this.paperTrader.executeVirtualBuy(decodedCandidate.mint, decodedCandidate.symbol, decision, platformName);
      }
    } catch {
      // Abaikan glitch
    }
  }

  private startPositionMonitor(): void {
    const trader = this.paperTrader;
    if (!trader) return;

    this.priceMonitorInterval = setInterval(async () => {
      if (this.stopped) return;

      // ─── 1. KELOLA POSISI TERBUKA (TP / SL / DEAD COIN) ───────────────────
      const openPositions = this.store.getOpenPaperTrades();
      if (openPositions.length > 0) {
        for (const pos of openPositions) {
          try {
            const curveAddress = this.store.getBondingCurveByMint(pos.mint);
            const priceInfo = await resolveTokenPriceAndMetadata(this.rpc, pos.mint, curveAddress);
            if (!priceInfo || priceInfo.priceInSol <= 0) continue;

            const currentPrice = priceInfo.priceInSol;
            const pnlPercent = Number(
              (((currentPrice - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2)
            );
            const holdTimeSec = Math.floor((Date.now() - pos.openedAt) / 1000);

            // Update symbol jika masih nama generic WHALE_GEM
            if (priceInfo.symbol && priceInfo.symbol !== "WHALE_GEM" && pos.symbol === "WHALE_GEM") {
              pos.symbol = priceInfo.symbol;
              this.store.savePaperTrade(pos);
            }

            const summary = trader.getPortfolioSummary();

            // Tampilkan live tracking posisi di terminal lengkap dengan saldo kas & net PnL ter-update
            logger.info(
              {
                symbol: pos.symbol,
                platform: pos.platform || "PUMP.FUN",
                currentPrice,
                pnlPercent,
                tp1Price: pos.tp1Price,
                slPrice: pos.slPrice,
                holdTimeSec,
                stage: pos.stage,
                saldoKas: summary.virtualBalanceSol,
                totalNetPnl: `${summary.netPnlSign}${summary.totalPnlSol} SOL (${summary.netPnlSign}${summary.growthPercent}%)`,
              },
              `[TRACKING] Live update ${pos.symbol} (PnL: ${pnlPercent >= 0 ? "+" : ""}${pnlPercent}%) | Saldo Kas: ${summary.virtualBalanceSol} SOL | Net PnL: ${summary.netPnlSign}${summary.totalPnlSol} SOL`
            );

            // ─── DEAD COIN TIMEOUT DIPANGKAS (DARI 75s JADI 35s) ───
            // Jika dalam 35 detik koin tidak bergerak (|pnl| <= 1.5%), LANGSUNG CUT!
            if (pos.stage === 0 && ((holdTimeSec >= 35 && Math.abs(pnlPercent) <= 1.5) || holdTimeSec >= 75)) {
              const exitResult = trader.forceExitPosition(pos.mint, currentPrice, "STAGNANT_EXIT");
              if (exitResult && exitResult.closedTrade) {
                const s = trader.getPortfolioSummary();
                console.log(
                  `\n📊 [LIVE UPDATE STATS] Saldo Kas: ${s.virtualBalanceSol} SOL | Portofolio: ${s.totalPortfolioSol} SOL | Total Net PnL: ${s.netPnlSign}${s.totalPnlSol} SOL (${s.netPnlSign}${s.growthPercent}%) | Selesai: ${s.totalTrades} trade (${s.winCount}W/${s.lossCount}L | WR: ${s.winRate})\n`
                );
              }
              continue;
            }

              // ─── TAKE PROFIT BERTAHAP & BREAKEVEN SL ───
              const exitResult = trader.updatePositionPrice(pos.mint, currentPrice);

              if (exitResult && exitResult.closedTrade) {
                const s = trader.getPortfolioSummary();
                console.log(
                  `\n📊 [LIVE UPDATE STATS] Saldo Kas: ${s.virtualBalanceSol} SOL | Portofolio: ${s.totalPortfolioSol} SOL | Total Net PnL: ${s.netPnlSign}${s.totalPnlSol} SOL (${s.netPnlSign}${s.growthPercent}%) | Selesai: ${s.totalTrades} trade (${s.winCount}W/${s.lossCount}L | WR: ${s.winRate})\n`
                );
              }
            } catch {
              // Abaikan glitch RPC berkala
            }
        }
      }

      // ─── 2. MONITOR PRE-JEET CANDIDATES (DETEKSI DEV BUANG SEMUA TOKEN) ───
      const now = Date.now();
      const preJeetList = Array.from(this.preJeetCandidates.values()).slice(0, 3);
      for (const cand of preJeetList) {
        if (now - cand.detectedAt > 240_000) {
          this.preJeetCandidates.delete(cand.mint);
          continue;
        }

        try {
          const curveData = await getBondingCurveMetrics(this.rpc, cand.bondingCurve);
          if (!curveData) continue;

          // Dev Jeet jika holding dev anjlok ke <= 1.0% (atau drop > 70% dari porsi awal)
          if (
            (curveData.metrics.devHoldingPct <= 1.0 || curveData.metrics.devHoldingPct <= cand.initialHoldingPct * 0.3) &&
            curveData.metrics.priceInSol <= cand.initialPrice * 0.90
          ) {
            this.ctoTracker.recordDevJeet(
              cand.mint,
              cand.symbol,
              cand.creator,
              curveData.metrics.priceInSol,
              cand.bondingCurve,
              curveData.metrics.realSolCollected
            );
            this.preJeetCandidates.delete(cand.mint);
          }
        } catch {
          // Abaikan glitch
        }
      }

      // ─── 3. EVALUASI V-SHAPE REBOUND DARI WATCHED CTO TOKENS ───────────────
      const watchedCto = this.ctoTracker.getWatchList();
      for (const item of watchedCto) {
        try {
          const curveData = await getBondingCurveMetrics(this.rpc, item.bondingCurve);
          if (!curveData) continue;

          const rebound = this.ctoTracker.evaluateRebound(
            item.mint,
            curveData.metrics.priceInSol,
            curveData.metrics.realSolCollected
          );

          if (rebound && rebound.isConfirmed) {
            const currentOpen = this.store.getOpenPaperTrades();
            if (currentOpen.length < MAX_CONCURRENT_POSITIONS && !currentOpen.some(p => p.mint === item.mint)) {
              const decision = evaluateSniperStrategy({
                tokenSecurity: {
                  signature: "cto_rebound",
                  mint: item.mint,
                  verdict: "ALLOW",
                  score: 95,
                  checks: [],
                  reasons: ["CTO Rebound Verified"],
                  assessedAt: Date.now(),
                },
                creator: {
                  address: item.creator,
                  balanceSol: 0,
                  txCount: 0,
                  walletAgeMinutes: null,
                  isBurnerWallet: false,
                },
                bondingCurve: curveData.metrics,
                manipulation: {
                  holderMetrics: {
                    topHolderPct: 5,
                    top5CombinedPct: 15,
                    bondingCurvePct: 80,
                    isCabalRisk: false,
                  },
                  washTradingMetrics: {
                    totalTx: 10,
                    uniqueWallets: 8,
                    uniqueWalletRatio: 0.8,
                    isWashTrading: false,
                  },
                  checks: [],
                },
                isCtoRebound: true,
                config: {
                  baseBuyAmountSol: BASE_BUY_AMOUNT_SOL,
                  highConvictionBuyAmountSol: 0.03,
                },
              });

              if (decision.shouldSnipe) {
                logger.info(
                  {
                    symbol: item.symbol,
                    mint: item.mint,
                    buyAmount: decision.recommendedBuySol,
                    reboundPercent: rebound.reboundPercent,
                  },
                  `🚀 [CTO REBOUND ENTRY] Konfirmasi pantulan V-Shape (+${rebound.reboundPercent}%)! Beli High Conviction 0.03 SOL!`
                );
                trader.executeVirtualBuy(item.mint, item.symbol, decision, "PUMP.FUN (CTO)");
              }
            }
          }
        } catch {
          // Abaikan glitch
        }
      }
    }, 4000);
  }
}

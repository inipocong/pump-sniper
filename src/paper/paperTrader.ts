import { Store, PaperTrade } from "../db.js";
import type { SniperDecision } from "../risk/sniperStrategy.js";
import { logger } from "../logger.js";

export const INITIAL_CAPITAL_USD = 15.0; // Modal awal $15 USD
export const SOL_PRICE_USD = 175.0;      // Estimasi kurs acuan Solana (~$175/SOL)
export const INITIAL_CAPITAL_SOL = Number((INITIAL_CAPITAL_USD / SOL_PRICE_USD).toFixed(4)); // ~0.0857 SOL

export interface PaperTraderConfig {
  initialVirtualBalanceSol: number; // Saldo awal virtual (default: 0.0857 SOL = $15)
  maxConcurrentPositions: number;   // Batas posisi serentak (default: 3 posisi untuk modal $15)
  pumpFunFeePct: number;            // Fee platform Pump.fun per swap (default: 1% = 0.01)
  networkPriorityFeeSol: number;    // Solana priority network fee per tx (default: 0.0008 SOL)
}

export const DEFAULT_PAPER_CONFIG: PaperTraderConfig = {
  initialVirtualBalanceSol: INITIAL_CAPITAL_SOL,
  maxConcurrentPositions: 3,
  pumpFunFeePct: 0.01,           // 1% platform fee
  networkPriorityFeeSol: 0.0008, // 0.0008 SOL priority fee gas/tip
};

export class PaperTrader {
  private config: PaperTraderConfig;

  constructor(
    private store: Store,
    config: Partial<PaperTraderConfig> = {}
  ) {
    this.config = { ...DEFAULT_PAPER_CONFIG, ...config };
  }

  /**
   * Saldo virtual kas standby yang dihitung secara dinamis dari database SQLite.
   * Tidak akan ter-reset saat bot di-restart — murni bertambah saat TP atau berkurang saat SL!
   */
  getVirtualBalance(): number {
    const stats = this.store.getPaperTradeStats();
    const openTrades = this.store.getOpenPaperTrades();

    let openCommittedSol = 0;
    for (const t of openTrades) {
      const buyFee = (t.costSol * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
      const initialOutflow = t.costSol + buyFee;
      // Kurangi komitmen dengan kas yang sudah kembali dari partial TP
      const netLocked = initialOutflow - (t.realizedPnlSol ?? 0);
      openCommittedSol += Math.max(0, netLocked);
    }

    const balance = this.config.initialVirtualBalanceSol + stats.totalPnlSol - openCommittedSol;
    return Number(Math.max(0, balance).toFixed(5));
  }

  /**
   * Eksekusi Beli Virtual (Paper Buy)
   */
  executeVirtualBuy(
    mint: string,
    symbol: string,
    decision: SniperDecision,
    platform: string = "PUMP.FUN"
  ): PaperTrade | null {
    if (!decision.shouldSnipe) return null;

    // Batasi jumlah posisi terbuka (maksimal 3 posisi serentak untuk modal $15)
    const openTrades = this.store.getOpenPaperTrades();
    if (openTrades.length >= this.config.maxConcurrentPositions) {
      return null;
    }

    const cost = decision.recommendedBuySol;
    const buyFee = (cost * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
    const totalOutflow = cost + buyFee;

    const currentBalance = this.getVirtualBalance();
    if (currentBalance < totalOutflow) {
      logger.warn(
        { balance: currentBalance, needed: totalOutflow },
        "Saldo virtual tidak mencukupi untuk melakukan simulasi beli"
      );
      return null;
    }

    const entryPrice = decision.entryPriceSol;
    const tokensBought = Math.floor(cost / entryPrice);

    const trade: PaperTrade = {
      id: `paper_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      mint,
      symbol,
      platform,
      entryPrice,
      tokensBought,
      tokensRemaining: tokensBought,
      costSol: cost,
      tp1Price: decision.targets.takeProfit1Price, // +50%
      tp2Price: decision.targets.takeProfit2Price, // +100%
      tp3Price: decision.targets.takeProfit3Price, // +200%
      slPrice: decision.targets.stopLossPrice,     // -12% awal
      stage: 0,
      realizedPnlSol: 0,
      status: "OPEN",
      exitPrice: null,
      pnlSol: null,
      pnlPercent: null,
      openedAt: Date.now(),
      closedAt: null,
    };

    // Simpan posisi ke SQLite
    this.store.savePaperTrade(trade);

    const summary = this.getPortfolioSummary();

    logger.info(
      {
        tradeId: trade.id,
        mint: trade.mint,
        symbol: trade.symbol,
        platform: trade.platform,
        convictionTier: decision.convictionLevel,
        isHighConviction: decision.isHighConviction,
        costSol: trade.costSol,
        buyFeeSol: Number(buyFee.toFixed(5)),
        tokensBought: trade.tokensBought,
        entryPrice: trade.entryPrice,
        tp1Target: trade.tp1Price,
        tp2Target: trade.tp2Price,
        tp3Target: trade.tp3Price,
        slTarget: trade.slPrice,
        saldoKasStandby: summary.virtualBalanceSol,
        totalPortofolio: summary.totalPortfolioSol,
        totalNetPnl: `${summary.netPnlSign}${summary.totalPnlSol} SOL (${summary.netPnlSign}${summary.growthPercent}%)`,
      },
      `🛒 [PAPER BUY] [${trade.platform}] Beli ${symbol} (${decision.convictionLevel}: ${cost} SOL) | Kas Standby: ${summary.virtualBalanceSol} SOL | Net PnL: ${summary.netPnlSign}${summary.totalPnlSol} SOL`
    );

    return trade;
  }

  /**
   * Monitor Pergerakan Harga & Eksekusi Bertahap (Partial TP + Breakeven SL)
   */
  updatePositionPrice(
    mint: string,
    currentPriceSol: number
  ): { closedTrade: PaperTrade | null; partialTrade: PaperTrade | null; action: "TP1_HIT" | "TP2_HIT" | "TP3_HIT" | "SL_HIT" | "HOLD" } {
    const openTrades = this.store.getOpenPaperTrades();
    const trade = openTrades.find(t => t.mint === mint);

    if (!trade) {
      return { closedTrade: null, partialTrade: null, action: "HOLD" };
    }

    const buyFee = (trade.costSol * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
    const totalInvested = trade.costSol + buyFee;

    // ─── 1. CEK STOP LOSS (SL) ──────────────────────────────────────────────
    if (currentPriceSol <= trade.slPrice) {
      // Jual semua sisa token yang ada
      const tokensToSell = trade.tokensRemaining;
      const grossExit = tokensToSell * currentPriceSol;
      const sellFee = (grossExit * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
      const finalNetCash = grossExit - sellFee;

      const totalCashReturned = trade.realizedPnlSol + finalNetCash;
      const netPnlSol = Number((totalCashReturned - totalInvested).toFixed(5));
      const netPnlPercent = Number(((netPnlSol / totalInvested) * 100).toFixed(2));

      trade.tokensRemaining = 0;
      trade.exitPrice = currentPriceSol;
      trade.pnlSol = netPnlSol;
      trade.pnlPercent = netPnlPercent;
      trade.closedAt = Date.now();

      // Jika sebelumnya sudah sempat TP1, net profit biasanya tetap positif!
      const isWin = netPnlSol >= 0;
      trade.status = isWin ? "TP_HIT" : "SL_HIT";
      this.store.savePaperTrade(trade);

      const logPayload = {
        tradeId: trade.id,
        symbol: trade.symbol,
        exitPrice: currentPriceSol,
        pnlSol: netPnlSol,
        pnlPercent: `${netPnlPercent >= 0 ? "+" : ""}${netPnlPercent}%`,
        newBalance: this.getVirtualBalance(),
      };

      if (trade.stage >= 1) {
        logger.info(
          logPayload,
          `🛡️ [BREAKEVEN SL HIT] Sisa posisi keluar di harga aman! Hasil Akhir: Cuan ${netPnlSol} SOL (${netPnlPercent}%)`
        );
      } else {
        logger.warn(
          logPayload,
          `🛑 [PAPER SL HIT] Batas cut loss tersentuh! Rugi ${netPnlSol} SOL (${netPnlPercent}%)`
        );
      }

      return { closedTrade: trade, partialTrade: null, action: "SL_HIT" };
    }

    // ─── 2. CEK TAKE PROFIT 1 (+50%): JUAL 50% & SL NAIK KE BREAKEVEN ───────
    if (trade.stage === 0 && currentPriceSol >= trade.tp1Price) {
      const tokensToSell = Math.floor(trade.tokensBought * 0.50);
      const grossExit = tokensToSell * currentPriceSol;
      const sellFee = (grossExit * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
      const netCashReturned = grossExit - sellFee;

      trade.tokensRemaining -= tokensToSell;
      trade.realizedPnlSol += netCashReturned;
      trade.stage = 1;

      // Geser Stop Loss ke harga Entry + 2.5% (Breakeven + nutup fee transaksi!)
      const breakevenSl = Number((trade.entryPrice * 1.025).toExponential(6));
      trade.slPrice = breakevenSl;

      this.store.savePaperTrade(trade);

      logger.info(
        {
          tradeId: trade.id,
          symbol: trade.symbol,
          exitPrice: currentPriceSol,
          tokensSold: tokensToSell,
          tokensRemaining: trade.tokensRemaining,
          cashReturnedSol: Number(netCashReturned.toFixed(5)),
          newSlPrice: breakevenSl,
          newBalance: this.getVirtualBalance(),
        },
        `🎯 [PARTIAL TP1 HIT (+50%)] Amankan 50% profit! SL dinaikkan ke ${breakevenSl} SOL (100% BEBAS RISIKO!)`
      );

      return { closedTrade: null, partialTrade: trade, action: "TP1_HIT" };
    }

    // ─── 3. CEK TAKE PROFIT 2 (+100%): JUAL 25% & SL NAIK KE TP1 ────────────
    if (trade.stage === 1 && currentPriceSol >= trade.tp2Price) {
      const tokensToSell = Math.floor(trade.tokensBought * 0.25);
      const grossExit = tokensToSell * currentPriceSol;
      const sellFee = (grossExit * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
      const netCashReturned = grossExit - sellFee;

      trade.tokensRemaining -= tokensToSell;
      trade.realizedPnlSol += netCashReturned;
      trade.stage = 2;

      // Geser Stop Loss naik ke harga TP1 (+50%) untuk mengunci profit gajah!
      trade.slPrice = trade.tp1Price;

      this.store.savePaperTrade(trade);

      logger.info(
        {
          tradeId: trade.id,
          symbol: trade.symbol,
          exitPrice: currentPriceSol,
          tokensSold: tokensToSell,
          tokensRemaining: trade.tokensRemaining,
          cashReturnedSol: Number(netCashReturned.toFixed(5)),
          newSlPrice: trade.tp1Price,
          newBalance: this.getVirtualBalance(),
        },
        `🚀 [PARTIAL TP2 HIT (+100%)] Amankan 25% profit! SL dinaikkan ke level TP1 (${trade.tp1Price})`
      );

      return { closedTrade: null, partialTrade: trade, action: "TP2_HIT" };
    }

    // ─── 4. CEK TAKE PROFIT 3 (+200% / 3X): JUAL 25% TERAKHIR (FULL EXIT) ───
    if (trade.stage >= 1 && currentPriceSol >= trade.tp3Price) {
      const tokensToSell = trade.tokensRemaining;
      const grossExit = tokensToSell * currentPriceSol;
      const sellFee = (grossExit * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
      const finalNetCash = grossExit - sellFee;

      const totalCashReturned = trade.realizedPnlSol + finalNetCash;
      const netPnlSol = Number((totalCashReturned - totalInvested).toFixed(5));
      const netPnlPercent = Number(((netPnlSol / totalInvested) * 100).toFixed(2));

      trade.tokensRemaining = 0;
      trade.stage = 3;
      trade.status = "TP_HIT";
      trade.exitPrice = currentPriceSol;
      trade.pnlSol = netPnlSol;
      trade.pnlPercent = netPnlPercent;
      trade.closedAt = Date.now();

      this.store.savePaperTrade(trade);

      logger.info(
        {
          tradeId: trade.id,
          symbol: trade.symbol,
          exitPrice: currentPriceSol,
          pnlSol: netPnlSol,
          pnlPercent: `+${netPnlPercent}%`,
          newBalance: this.getVirtualBalance(),
        },
        `🌕 [FINAL TP3 HIT (+200% / 3X)] Semua target cuan tercapai! Total profit: +${netPnlSol} SOL (+${netPnlPercent}%)`
      );

      return { closedTrade: trade, partialTrade: null, action: "TP3_HIT" };
    }

    return { closedTrade: null, partialTrade: null, action: "HOLD" };
  }

  /**
   * Eksekusi Jual Copy Trade Proporsional (Sesuai persentase penjualan target whale)
   */
  executeCopySell(
    mint: string,
    pctToSell: number,
    currentPriceSol: number
  ): { closedTrade: PaperTrade | null; partialTrade: PaperTrade | null; pctSold: number } {
    const openTrades = this.store.getOpenPaperTrades();
    const trade = openTrades.find(t => t.mint === mint);

    if (!trade) {
      return { closedTrade: null, partialTrade: null, pctSold: 0 };
    }

    const buyFee = (trade.costSol * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
    const totalInvested = trade.costSol + buyFee;

    const isFullExit = pctToSell >= 95 || trade.tokensRemaining <= 1;
    const tokensToSell = isFullExit
      ? trade.tokensRemaining
      : Math.min(trade.tokensRemaining, Math.max(1, Math.floor(trade.tokensRemaining * (pctToSell / 100))));

    const grossExit = tokensToSell * currentPriceSol;
    const sellFee = (grossExit * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
    const netCashReturned = grossExit - sellFee;

    trade.tokensRemaining -= tokensToSell;
    trade.realizedPnlSol += netCashReturned;

    if (isFullExit || trade.tokensRemaining <= 0) {
      trade.tokensRemaining = 0;
      trade.status = "TP_HIT"; // Catat sebagai closed trade
      trade.exitPrice = currentPriceSol;
      const netPnlSol = Number((trade.realizedPnlSol - totalInvested).toFixed(5));
      const netPnlPercent = Number(((netPnlSol / totalInvested) * 100).toFixed(2));
      trade.pnlSol = netPnlSol;
      trade.pnlPercent = netPnlPercent;
      trade.closedAt = Date.now();

      this.store.savePaperTrade(trade);

      const summary = this.getPortfolioSummary();
      logger.info(
        {
          tradeId: trade.id,
          symbol: trade.symbol,
          pctSold: 100,
          exitPrice: currentPriceSol,
          pnlSol: netPnlSol,
          pnlPercent: `${netPnlPercent >= 0 ? "+" : ""}${netPnlPercent}%`,
          newBalance: summary.virtualBalanceSol,
        },
        `🐋 [COPY SELL FULL EXIT] Ikut whale jual habis (100%) token ${trade.symbol}! Net PnL: ${summary.netPnlSign}${netPnlSol} SOL (${netPnlPercent}%)`
      );

      return { closedTrade: trade, partialTrade: null, pctSold: 100 };
    } else {
      this.store.savePaperTrade(trade);

      const summary = this.getPortfolioSummary();
      logger.info(
        {
          tradeId: trade.id,
          symbol: trade.symbol,
          pctSold: pctToSell,
          tokensSold: tokensToSell,
          tokensRemaining: trade.tokensRemaining,
          cashReturnedSol: Number(netCashReturned.toFixed(5)),
          newBalance: summary.virtualBalanceSol,
        },
        `🐋 [COPY SELL PARTIAL] Ikut whale jual ${pctToSell.toFixed(1)}% token ${trade.symbol}! Kas Masuk: +${netCashReturned.toFixed(4)} SOL`
      );

      return { closedTrade: null, partialTrade: trade, pctSold: pctToSell };
    }
  }

  /**
   * Tutup Posisi Secara Paksa (Timeout koin mati/stagnan)
   */
  forceExitPosition(
    mint: string,
    currentPriceSol: number,
    action: "STAGNANT_EXIT" = "STAGNANT_EXIT"
  ): { closedTrade: PaperTrade | null; action: "STAGNANT_EXIT" } {
    const openTrades = this.store.getOpenPaperTrades();
    const trade = openTrades.find(t => t.mint === mint);

    if (!trade) {
      return { closedTrade: null, action: "STAGNANT_EXIT" };
    }

    const buyFee = (trade.costSol * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
    const totalInvested = trade.costSol + buyFee;

    const grossExit = trade.tokensRemaining * currentPriceSol;
    const sellFee = (grossExit * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
    const finalNetCash = grossExit - sellFee;

    const totalCashReturned = trade.realizedPnlSol + finalNetCash;
    const netPnlSol = Number((totalCashReturned - totalInvested).toFixed(5));
    const netPnlPercent = Number(((netPnlSol / totalInvested) * 100).toFixed(2));

    trade.tokensRemaining = 0;
    trade.status = "STAGNANT_EXIT";
    trade.exitPrice = currentPriceSol;
    trade.pnlSol = netPnlSol;
    trade.pnlPercent = netPnlPercent;
    trade.closedAt = Date.now();

    this.store.savePaperTrade(trade);

    logger.warn(
      {
        tradeId: trade.id,
        symbol: trade.symbol,
        exitPrice: currentPriceSol,
        pnlSol: netPnlSol,
        pnlPercent: `${netPnlPercent}%`,
        newBalance: this.getVirtualBalance(),
      },
      `⏱️ [PAPER STAGNANT EXIT] Koin stagnan/mati >75s! Auto cut: ${netPnlSol} SOL (${netPnlPercent}%)`
    );

    return { closedTrade: trade, action: "STAGNANT_EXIT" };
  }

  /**
   * Menampilkan ringkasan portofolio simulasi secara real-time
   */
  getPortfolioSummary() {
    const openPositions = this.store.getOpenPaperTrades();
    const stats = this.store.getPaperTradeStats();
    const virtualBalanceSol = this.getVirtualBalance();

    let openCommittedSol = 0;
    for (const t of openPositions) {
      const buyFee = (t.costSol * this.config.pumpFunFeePct) + this.config.networkPriorityFeeSol;
      const netLocked = (t.costSol + buyFee) - (t.realizedPnlSol ?? 0);
      openCommittedSol += Math.max(0, netLocked);
    }

    const totalPortfolioSol = Number((virtualBalanceSol + openCommittedSol).toFixed(5));
    const growthPercent = Number(((stats.totalPnlSol / this.config.initialVirtualBalanceSol) * 100).toFixed(2));
    const netPnlSign = stats.totalPnlSol >= 0 ? "+" : "";

    return {
      virtualBalanceSol,
      totalPortfolioSol,
      openCommittedSol: Number(openCommittedSol.toFixed(5)),
      openPositionsCount: openPositions.length,
      totalTrades: stats.totalTrades,
      winCount: stats.winCount,
      lossCount: stats.lossCount,
      totalPnlSol: stats.totalPnlSol,
      netPnlSign,
      growthPercent,
      winRate:
        stats.totalTrades > 0
          ? `${((stats.winCount / stats.totalTrades) * 100).toFixed(1)}%`
          : "0%",
    };
  }
}

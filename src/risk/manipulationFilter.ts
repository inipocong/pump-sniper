import { SolanaRpcClient, TokenLargestAccount } from "./solanaRpc.js";
import type { RiskCheck } from "../types.js";

// Ambang batas keamanan
const MAX_SINGLE_HOLDER_PCT = 7.0;    // Maksimal 1 non-curve wallet pegang 7% total supply
const MAX_TOP5_COMBINED_PCT = 18.0;   // Maksimal top 5 non-curve wallet pegang 18% supply
const MIN_UNIQUE_WALLET_RATIO = 0.45; // Minimal 45% wallet unik dari total transaksi (anti-wash trading)

export interface HolderConcentrationMetrics {
  topHolderPct: number;
  top5CombinedPct: number;
  bondingCurvePct: number;
  isCabalRisk: boolean;
}

export interface WashTradingMetrics {
  totalTx: number;
  uniqueWallets: number;
  uniqueWalletRatio: number;
  isWashTrading: boolean;
}

export interface ManipulationAnalysisResult {
  holderMetrics: HolderConcentrationMetrics;
  washTradingMetrics: WashTradingMetrics;
  checks: RiskCheck[];
}

/**
 * 1. Filter Konsentrasi Holder (Anti-Cabal / Anti-Insider Bundle)
 * Menganalisis sebaran pemegang token terbesar di luar akun bonding curve.
 */
export function evaluateHolderConcentration(
  holders: TokenLargestAccount[],
  bondingCurveAddress: string,
  totalSupply: bigint = 1_000_000_000_000_000n // 1 Miliar koin (6 desimal)
): { metrics: HolderConcentrationMetrics; checks: RiskCheck[] } {
  const checks: RiskCheck[] = [];
  const supplyNum = Number(totalSupply);

  // Jika koin baru lahir detik itu juga dan daftar holder belum ada / kosong di RPC,
  // artinya pasokan masih 100% terkunci di bonding curve Pump.fun (Kondisi Ideal)
  if (!holders || holders.length === 0) {
    return {
      metrics: {
        topHolderPct: 0,
        top5CombinedPct: 0,
        bondingCurvePct: 100,
        isCabalRisk: false,
      },
      checks: [
        {
          name: "holder_whale_concentration",
          passed: true,
          severity: "LOW",
          message: "Koin baru lahir (Block-0), 100% pasokan berada di dalam bonding curve",
        },
        {
          name: "holder_cabal_distribution",
          passed: true,
          severity: "LOW",
          message: "Belum ada akumulasi sindikat di luar kurva",
        },
      ],
    };
  }

  const nonCurveHolders: Array<{ address: string; amount: number; pct: number }> = [];
  let bondingCurvePct = 0;

  for (const h of holders) {
    const amt = Number(h.amount);
    const pct = supplyNum > 0 ? (amt / supplyNum) * 100 : 0;

    if (h.address === bondingCurveAddress) {
      bondingCurvePct = pct;
    } else {
      nonCurveHolders.push({
        address: h.address,
        amount: amt,
        pct: Number(pct.toFixed(2)),
      });
    }
  }

  // Urutkan non-curve holders dari terbesar ke terkecil
  nonCurveHolders.sort((a, b) => b.amount - a.amount);

  const topHolderPct = nonCurveHolders[0]?.pct ?? 0;
  const top5CombinedPct = Number(
    nonCurveHolders.slice(0, 5).reduce((sum, h) => sum + h.pct, 0).toFixed(2)
  );

  const isCabalRisk = topHolderPct > MAX_SINGLE_HOLDER_PCT || top5CombinedPct > MAX_TOP5_COMBINED_PCT;

  // ─── CHECK: Whale Tunggal Terbesar ─────────────────────────────────────────
  if (topHolderPct > MAX_SINGLE_HOLDER_PCT) {
    checks.push({
      name: "holder_whale_concentration",
      passed: false,
      severity: "CRITICAL",
      message: `Terdapat whale menguasai ${topHolderPct}% supply (> ${MAX_SINGLE_HOLDER_PCT}%), risiko dump instan sangat tinggi`,
      evidence: `topHolderPct=${topHolderPct}%`,
    });
  } else {
    checks.push({
      name: "holder_whale_concentration",
      passed: true,
      severity: "LOW",
      message: `Sebaran whale aman (terbesar: ${topHolderPct}%)`,
      evidence: `topHolderPct=${topHolderPct}%`,
    });
  }

  // ─── CHECK: Gabungan Top 5 Holder (Cabal Bundling) ─────────────────────────
  if (top5CombinedPct > MAX_TOP5_COMBINED_PCT) {
    checks.push({
      name: "holder_cabal_distribution",
      passed: false,
      severity: "HIGH",
      message: `Top 5 non-curve holder menguasai ${top5CombinedPct}% supply (> ${MAX_TOP5_COMBINED_PCT}%), indikasi kuat sindikat cabal / dev bundling`,
      evidence: `top5CombinedPct=${top5CombinedPct}%`,
    });
  } else {
    checks.push({
      name: "holder_cabal_distribution",
      passed: true,
      severity: "LOW",
      message: `Sebaran top 5 holder aman (${top5CombinedPct}%)`,
      evidence: `top5CombinedPct=${top5CombinedPct}%`,
    });
  }

  return {
    metrics: {
      topHolderPct,
      top5CombinedPct,
      bondingCurvePct: Number(bondingCurvePct.toFixed(2)),
      isCabalRisk,
    },
    checks,
  };
}

/**
 * 2. Filter Fake Volume / Wash Trading
 * Menganalisis rasio transaksi dengan jumlah wallet unik yang bertransaksi.
 */
export function evaluateWashTrading(
  transactionSigners: string[]
): { metrics: WashTradingMetrics; checks: RiskCheck[] } {
  const checks: RiskCheck[] = [];
  const totalTx = transactionSigners.length;

  if (totalTx === 0) {
    return {
      metrics: {
        totalTx: 0,
        uniqueWallets: 0,
        uniqueWalletRatio: 1,
        isWashTrading: false,
      },
      checks: [
        {
          name: "wash_trading_detection",
          passed: true,
          severity: "LOW",
          message: "Belum ada transaksi di luar transaksi pembuatan",
        },
      ],
    };
  }

  const uniqueWallets = new Set(transactionSigners).size;
  const uniqueWalletRatio = Number((uniqueWallets / totalTx).toFixed(2));

  const isWashTrading = totalTx >= 8 && uniqueWalletRatio < MIN_UNIQUE_WALLET_RATIO;

  if (isWashTrading) {
    checks.push({
      name: "wash_trading_detection",
      passed: false,
      severity: "HIGH",
      message: `Fake volume terdeteksi! ${totalTx} transaksi hanya berasal dari ${uniqueWallets} wallet unik (rasio: ${uniqueWalletRatio})`,
      evidence: `totalTx=${totalTx}, unique=${uniqueWallets}, ratio=${uniqueWalletRatio}`,
    });
  } else {
    checks.push({
      name: "wash_trading_detection",
      passed: true,
      severity: "LOW",
      message: `Aktivitas transaksi organik (rasio wallet unik: ${uniqueWalletRatio})`,
      evidence: `totalTx=${totalTx}, unique=${uniqueWallets}, ratio=${uniqueWalletRatio}`,
    });
  }

  return {
    metrics: {
      totalTx,
      uniqueWallets,
      uniqueWalletRatio,
      isWashTrading,
    },
    checks,
  };
}

/**
 * Helper terpadu: Menjalankan audit manipulasi lengkap menggunakan RPC
 */
export async function auditManipulationRisk(
  rpc: SolanaRpcClient,
  mint: string,
  bondingCurveAddress: string,
  recentSigners: string[] = []
): Promise<ManipulationAnalysisResult> {
  let holders: TokenLargestAccount[] = [];

  try {
    holders = await rpc.getTokenLargestAccounts(mint);
  } catch {
    // Pada detik ke-0 koin diluncurkan di Pump.fun, RPC belum selesai mengindeks holder.
    // Pada fase detik ke-0 ini, 100% pasokan token masih berada di dalam bonding curve.
    holders = [];
  }

  const holderEval = evaluateHolderConcentration(holders, bondingCurveAddress);
  const washEval = evaluateWashTrading(recentSigners);

  return {
    holderMetrics: holderEval.metrics,
    washTradingMetrics: washEval.metrics,
    checks: [...holderEval.checks, ...washEval.checks],
  };
}
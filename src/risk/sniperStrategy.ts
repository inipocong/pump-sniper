import type { RiskAssessment } from "../types.js";
import type { CreatorProfile } from "./creatorAnalysis.js";
import type { BondingCurveMetrics } from "./bondingCurve.js";
import type { ManipulationAnalysisResult } from "./manipulationFilter.js";
import { evaluateVolumeMetrics, VolumeMetrics } from "./volumeFilter.js";

export type ConvictionTier = "EXPLORATORY" | "STANDARD" | "HIGH_CONVICTION";

export interface SniperStrategyConfig {
  maxBondingCurveProgress: number; // Batas maksimal progress kurva (default: 20%)
  minConfidenceScore: number;       // Skor keyakinan minimal (default: 80)
  exploratoryBuyAmountSol: number;  // Alokasi tier radar eksplorasi skor 80-84 (0.010 SOL)
  baseBuyAmountSol: number;         // Alokasi beli standar skor 85-89 (0.015 SOL)
  highConvictionBuyAmountSol: number; // Alokasi beli koin super meyakinkan >=90 (0.030 SOL)
  strictDevCheck: boolean;          // Apakah tolak jika dev burner wallet (default: false)
  minDevInitialSol: number;         // Minimal modal awal dev di kurva (default: 0.5 SOL)
  minDevHoldingPct: number;         // Golden Sweet Spot minimal kepemilikan dev (default: 4.5%)
  maxDevHoldingPct: number;         // Golden Sweet Spot maksimal kepemilikan dev (default: 12.5%)
  minVolumeSol: number;             // Minimal volume likuiditas di kurva (default: 0.60 SOL)
  surgeVolumeSol: number;           // Ambang batas volume ledakan / surge (default: 2.0 SOL)
  tp1Multiplier: number;            // Target TP 1 (+50%)
  tp2Multiplier: number;            // Target TP 2 (+100%)
  tp3Multiplier: number;            // Target TP 3 (+200%)
  slMultiplier: number;             // Batas Stop Loss awal (-12%)
}

export const DEFAULT_STRATEGY_CONFIG: SniperStrategyConfig = {
  maxBondingCurveProgress: 20.0,
  minConfidenceScore: 80,          // Ambang batas masuk radar diturunkan ke 80!
  exploratoryBuyAmountSol: 0.010,   // Skor 80-84: Margin aman 0.010 SOL
  baseBuyAmountSol: 0.015,          // Skor 85-89: Margin standar 0.015 SOL
  highConvictionBuyAmountSol: 0.030,// Skor >=90 / CTO / Surge: 0.030 SOL
  strictDevCheck: false,
  minDevInitialSol: 0.5,   // Dev wajib setor minimal 0.5 SOL (~$88) di awal!
  minDevHoldingPct: 4.5,   // Dev minimal pegang 4.5% suplai (anti-dev miskin/ghost coin)
  maxDevHoldingPct: 12.5,  // Dev maksimal pegang 12.5% suplai (anti-dev dump nuklir)
  minVolumeSol: 0.60,      // Minimal volume 0.60 SOL (~$105) terkumpul di kurva
  surgeVolumeSol: 2.00,    // Volume >= 2.0 SOL = Volume Surge (Momentum Beli Masif)
  tp1Multiplier: 1.50,     // +50%
  tp2Multiplier: 2.00,     // +100%
  tp3Multiplier: 3.00,     // +200%
  slMultiplier: 0.88,      // -12% cut loss awal
};

export interface SniperTargets {
  takeProfit1Price: number;
  takeProfit2Price: number;
  takeProfit3Price: number;
  stopLossPrice: number;
}

export interface SniperDecision {
  shouldSnipe: boolean;
  confidenceScore: number;
  convictionLevel: ConvictionTier;
  isHighConviction: boolean;
  recommendedBuySol: number;
  entryPriceSol: number;
  targets: SniperTargets;
  reasons: string[];
  abortReasons: string[];
}

export interface SniperStrategyInput {
  tokenSecurity: RiskAssessment;
  creator: CreatorProfile;
  bondingCurve: BondingCurveMetrics;
  manipulation: ManipulationAnalysisResult;
  volume?: VolumeMetrics;
  config?: Partial<SniperStrategyConfig>;
  isGraduation?: boolean;
  isCtoRebound?: boolean;
}

export function evaluateSniperStrategy(input: SniperStrategyInput): SniperDecision {
  const cfg = { ...DEFAULT_STRATEGY_CONFIG, ...(input.config ?? {}) };
  const { tokenSecurity, creator, bondingCurve, manipulation } = input;

  const reasons: string[] = [];
  const abortReasons: string[] = [];
  let score = 100;

  // ─── 1. HARD STOP: Keamanan Mint & Token-2022 (Anti-High Fee / Honeypot) ──
  if (tokenSecurity.verdict !== "ALLOW") {
    abortReasons.push(`Keamanan token tidak lolos (Status: ${tokenSecurity.verdict})`);
  } else {
    reasons.push("Token bersih dari biaya tersembunyi / honeypot Token-2022");
  }

  // ─── 2. HARD STOP: Wajib Ada Komitmen Modal Dev (Anti-Koin Hantu) ──────────
  if (!input.isCtoRebound && bondingCurve.realSolCollected < cfg.minDevInitialSol) {
    abortReasons.push(
      `Dev modal receh / tidak beli awal (Terkumpul: ${bondingCurve.realSolCollected.toFixed(3)} SOL < minimal ${cfg.minDevInitialSol} SOL)`
    );
  } else {
    reasons.push(`Dev komitmen modal awal (${bondingCurve.realSolCollected.toFixed(3)} SOL di kurva)`);
  }

  // ─── 3. HARD STOP: Golden Dev Holding (Sweet Spot 4.5% - 12.5% Suplai) ────
  const devHolding = bondingCurve.devHoldingPct ?? 0;
  if (!input.isCtoRebound) {
    if (devHolding < cfg.minDevHoldingPct) {
      abortReasons.push(
        `Alokasi dev terlalu kecil (${devHolding}% < ${cfg.minDevHoldingPct}%) - dev minim komitmen`
      );
    } else if (devHolding > cfg.maxDevHoldingPct) {
      abortReasons.push(
        `Alokasi dev terlalu serakah (${devHolding}% > ${cfg.maxDevHoldingPct}%) - risiko dev dump nuklir`
      );
    } else {
      reasons.push(`🏆 Golden Dev Holding (${devHolding}% suplai - porsi ideal 4.5% - 12.5%)`);
      score += 10;
    }
  } else {
    reasons.push("🚀 CTO REBOUND: Dev holding = 0% (100% Bebas Risiko Rug Pull Dev!)");
    score += 20;
  }

  // ─── 4. HARD STOP: Filter Volume Transaksi & Likuiditas (Anti-Ghost Coin) ──
  const volumeData = input.volume ?? evaluateVolumeMetrics(bondingCurve, 1, {
    minVolumeSol: cfg.minVolumeSol,
    surgeVolumeSol: cfg.surgeVolumeSol,
  }).metrics;

  if (!input.isCtoRebound && !input.isGraduation) {
    if (!volumeData.isVolumeHealthy) {
      abortReasons.push(
        `Volume transaksi terlalu sepi (Terkumpul: ${volumeData.totalSolVolume.toFixed(3)} SOL < minimal ${cfg.minVolumeSol} SOL) - koin mati suri / minim likuiditas`
      );
    } else {
      reasons.push(`Volume transaksi sehat (${volumeData.totalSolVolume.toFixed(3)} SOL terkumpul di kurva)`);
    }
  }

  // Bonus Volume Surge / Momentum Ledakan Beli (+15 Skor)
  if (volumeData.isVolumeSurge || input.isGraduation) {
    score += 15;
    reasons.push(`🔥 VOLUME SURGE: Momentum volume tinggi (${volumeData.totalSolVolume.toFixed(2)} SOL >= ${cfg.surgeVolumeSol} SOL)!`);
  }

  // ─── 4. HARD STOP: Status Bonding Curve ───────────────────────────────────
  if (!input.isGraduation) {
    if (bondingCurve.isComplete) {
      abortReasons.push("Koin sudah lulus ke Raydium");
    } else if (bondingCurve.progressPercent > cfg.maxBondingCurveProgress) {
      abortReasons.push(
        `Progress kurva sudah ${bondingCurve.progressPercent}% (> batas maksimal ${cfg.maxBondingCurveProgress}%)`
      );
    } else {
      reasons.push(`Progress kurva fase awal (${bondingCurve.progressPercent}%)`);
    }
  } else {
    reasons.push("🎓 Koin resmi lulus 85 SOL ke Raydium (Liquid & Verified Community!)");
    score += 15;
  }

  // ─── 5. HARD STOP: Risiko Manipulasi (Whale & Cabal) ───────────────────────
  if (manipulation.holderMetrics.isCabalRisk) {
    abortReasons.push(
      `Konsentrasi holder berbahaya (Top 1: ${manipulation.holderMetrics.topHolderPct}%, Top 5: ${manipulation.holderMetrics.top5CombinedPct}%)`
    );
  } else {
    reasons.push("Sebaran holder organik, bebas dari sindikat cabal");
  }

  // ─── 6. HARD STOP: Fake Volume / Wash Trading ─────────────────────────────
  if (manipulation.washTradingMetrics.isWashTrading) {
    abortReasons.push(
      `Aktivitas transaksi terindikasi wash trading (Rasio wallet unik: ${manipulation.washTradingMetrics.uniqueWalletRatio})`
    );
  } else {
    reasons.push("Volume transaksi organik");
  }

  // ─── 7. EVALUASI SKOR DEV ─────────────────────────────────────────────────
  if (creator.isBurnerWallet) {
    if (cfg.strictDevCheck) {
      abortReasons.push("Dev terindikasi burner wallet");
    } else {
      score -= 20;
      reasons.push("Catatan: Dev menggunakan wallet baru (-20 skor)");
    }
  } else {
    reasons.push(`Dev memiliki reputasi on-chain (${creator.txCount} tx, saldo ${creator.balanceSol} SOL)`);
  }

  if (creator.balanceSol < 0.05) {
    score -= 10;
  }

  const finalScore = Math.max(0, Math.min(100, score));

  if (finalScore < cfg.minConfidenceScore) {
    abortReasons.push(`Skor keyakinan ${finalScore} di bawah ambang batas minimal (${cfg.minConfidenceScore})`);
  }

  const shouldSnipe = abortReasons.length === 0;

  const entryPrice = bondingCurve.priceInSol;
  const targets: SniperTargets = input.isCtoRebound
    ? {
        takeProfit1Price: Number((entryPrice * 1.40).toExponential(6)), // +40% CTO breakout
        takeProfit2Price: Number((entryPrice * 2.00).toExponential(6)), // +100%
        takeProfit3Price: Number((entryPrice * 3.50).toExponential(6)), // +250% Moonbag
        stopLossPrice: Number((entryPrice * 0.88).toExponential(6)),    // -12% cut loss
      }
    : input.isGraduation
    ? {
        takeProfit1Price: Number((entryPrice * 1.35).toExponential(6)), // +35% quick pop Raydium
        takeProfit2Price: Number((entryPrice * 1.75).toExponential(6)), // +75%
        takeProfit3Price: Number((entryPrice * 2.50).toExponential(6)), // +150%
        stopLossPrice: Number((entryPrice * 0.90).toExponential(6)),    // -10% tight SL
      }
    : {
        takeProfit1Price: Number((entryPrice * cfg.tp1Multiplier).toExponential(6)),
        takeProfit2Price: Number((entryPrice * cfg.tp2Multiplier).toExponential(6)),
        takeProfit3Price: Number((entryPrice * cfg.tp3Multiplier).toExponential(6)),
        stopLossPrice: Number((entryPrice * cfg.slMultiplier).toExponential(6)),
      };

  // ─── PENENTUAN TIER KEYAKINAN & UKURAN MARGIN (3-TIER CONVICTION) ──────────
  // 1. HIGH CONVICTION (0.030 SOL):
  //    - Raydium Graduation, CTO Rebound, Volume Surge >= 2.0 SOL + Skor >= 90,
  //    - Atau Skor >= 90 & modal dev >= 1.5 SOL
  //    - Atau Dev on-chain + sweet spot 5-10% + modal >= 1.0 SOL
  // 2. STANDARD CONVICTION (0.015 SOL):
  //    - Skor 85 - 89 (Lolos semua filter standar)
  // 3. EXPLORATORY RADAR (0.010 SOL):
  //    - Skor 80 - 84 (Masuk radar tapi margin aman 0.010 SOL)
  const isHighConviction = Boolean(
    input.isGraduation ||
    input.isCtoRebound ||
    (volumeData.isVolumeSurge && finalScore >= 90) ||
    (finalScore >= 90 && bondingCurve.realSolCollected >= 1.5) ||
    (!creator.isBurnerWallet && bondingCurve.realSolCollected >= 1.0 && devHolding >= 5.0 && devHolding <= 10.0)
  );

  let convictionLevel: ConvictionTier = "STANDARD";
  let recommendedBuySol = 0;

  if (isHighConviction) {
    convictionLevel = "HIGH_CONVICTION";
    recommendedBuySol = cfg.highConvictionBuyAmountSol; // 0.030 SOL
    if (shouldSnipe) {
      reasons.push("🌕 SINYAL MOON KUAT: Alokasi beli maksimal 0.030 SOL!");
    }
  } else if (finalScore >= 85) {
    convictionLevel = "STANDARD";
    recommendedBuySol = cfg.baseBuyAmountSol; // 0.015 SOL
    if (shouldSnipe) {
      reasons.push("💎 GEM STANDAR: Skor 85-89, alokasi beli normal 0.015 SOL");
    }
  } else {
    convictionLevel = "EXPLORATORY";
    recommendedBuySol = cfg.exploratoryBuyAmountSol; // 0.010 SOL
    if (shouldSnipe) {
      reasons.push("🔭 RADAR IN: Skor 80-84, alokasi eksplorasi aman 0.010 SOL");
    }
  }

  if (!shouldSnipe) {
    recommendedBuySol = 0;
  }

  return {
    shouldSnipe,
    confidenceScore: finalScore,
    convictionLevel,
    isHighConviction,
    recommendedBuySol,
    entryPriceSol: entryPrice,
    targets,
    reasons,
    abortReasons,
  };
}

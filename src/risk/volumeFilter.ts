import type { BondingCurveMetrics } from "./bondingCurve.js";
import type { RiskCheck } from "../types.js";

export interface VolumeFilterConfig {
  minVolumeSol: number;       // Minimal total volume SOL di kurva (default: 0.60 SOL)
  surgeVolumeSol: number;     // Volume ledakan / momentum tinggi (default: 2.0 SOL)
  minTxCount: number;         // Minimal jumlah transaksi di kurva (default: 1)
}

export const DEFAULT_VOLUME_CONFIG: VolumeFilterConfig = {
  minVolumeSol: 0.60,         // Minimal 0.60 SOL (~$105) terkumpul agar koin terbukti diminati
  surgeVolumeSol: 2.00,       // Di atas 2.0 SOL dianggap terjadi lonjakan volume (Volume Surge)
  minTxCount: 1,
};

export type VolumeTier = "DEAD" | "LOW" | "HEALTHY" | "SURGE";

export interface VolumeMetrics {
  totalSolVolume: number;
  marketCapSol: number;
  txCount: number;
  volumeTier: VolumeTier;
  isVolumeHealthy: boolean;
  isVolumeSurge: boolean;
}

export interface VolumeAnalysisResult {
  metrics: VolumeMetrics;
  checks: RiskCheck[];
}

/**
 * Menganalisis volume transaksi & likuiditas token pada bonding curve:
 * 1. Memeriksa apakah likuiditas koin mati suri (< minVolumeSol).
 * 2. Memeriksa apakah terjadi lonjakan volume / momentum beli tinggi (Volume Surge >= surgeVolumeSol).
 * 3. Menghitung tier likuiditas untuk scoring probabilitas kenaikan harga.
 */
export function evaluateVolumeMetrics(
  bondingCurve: BondingCurveMetrics,
  txCount = 1,
  config?: Partial<VolumeFilterConfig>
): VolumeAnalysisResult {
  const cfg = { ...DEFAULT_VOLUME_CONFIG, ...config };
  const checks: RiskCheck[] = [];

  const totalSolVolume = bondingCurve.realSolCollected;
  const marketCapSol = bondingCurve.marketCapSol;

  let volumeTier: VolumeTier = "LOW";
  let isVolumeHealthy = false;
  let isVolumeSurge = false;

  if (totalSolVolume < 0.20) {
    volumeTier = "DEAD";
  } else if (totalSolVolume < cfg.minVolumeSol) {
    volumeTier = "LOW";
  } else if (totalSolVolume >= cfg.surgeVolumeSol) {
    volumeTier = "SURGE";
    isVolumeHealthy = true;
    isVolumeSurge = true;
  } else {
    volumeTier = "HEALTHY";
    isVolumeHealthy = true;
  }

  // ─── CHECK 1: Ambang Batas Minimal Volume Likuiditas ──────────────────────
  if (!isVolumeHealthy) {
    checks.push({
      name: "volume_liquidity_threshold",
      passed: false,
      severity: "HIGH",
      message: `Volume transaksi terlalu sepi (${totalSolVolume.toFixed(3)} SOL < minimal ${cfg.minVolumeSol} SOL) - likuiditas rendah`,
      evidence: `totalSolVolume=${totalSolVolume.toFixed(3)} SOL, minRequired=${cfg.minVolumeSol} SOL, tier=${volumeTier}`,
    });
  } else {
    checks.push({
      name: "volume_liquidity_threshold",
      passed: true,
      severity: "LOW",
      message: `Volume transaksi sehat (${totalSolVolume.toFixed(3)} SOL terkumpul di kurva)`,
      evidence: `totalSolVolume=${totalSolVolume.toFixed(3)} SOL, tier=${volumeTier}`,
    });
  }

  // ─── CHECK 2: Lonjakan Volume (Volume Surge / High Momentum) ──────────────
  if (isVolumeSurge) {
    checks.push({
      name: "volume_surge_momentum",
      passed: true,
      severity: "LOW",
      message: `🔥 Lonjakan volume masif terdeteksi (${totalSolVolume.toFixed(3)} SOL >= ${cfg.surgeVolumeSol} SOL)! Momentum beli kuat!`,
      evidence: `totalSolVolume=${totalSolVolume.toFixed(3)} SOL, surgeThreshold=${cfg.surgeVolumeSol} SOL`,
    });
  }

  return {
    metrics: {
      totalSolVolume,
      marketCapSol,
      txCount,
      volumeTier,
      isVolumeHealthy,
      isVolumeSurge,
    },
    checks,
  };
}

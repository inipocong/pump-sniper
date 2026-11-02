import { evaluateVolumeMetrics } from "../src/risk/volumeFilter.js";
import { evaluateSniperStrategy } from "../src/risk/sniperStrategy.js";

async function runVolumeFilterTest() {
  console.log("🧪 Memulai Pengujian Modul Filter Volume...\n");

  // 1. Uji Koin Mati Suri (Dead Volume < 0.20 SOL)
  const deadCurve = {
    priceInSol: 0.00000003,
    marketCapSol: 30,
    progressPercent: 0.1,
    realSolCollected: 0.089, // Seperti koin Cate2.0 (hanya 0.089 SOL)
    devHoldingPct: 2.19,
    isComplete: false,
  };
  const deadEval = evaluateVolumeMetrics(deadCurve);
  if (deadEval.metrics.volumeTier !== "DEAD" || deadEval.metrics.isVolumeHealthy) {
    throw new Error("Koin dengan 0.089 SOL seharusnya berstatus DEAD dan tidak sehat");
  }
  console.log("✅ 1. Deteksi Koin Volume Mati Suri (< 0.20 SOL): PASS");

  // 2. Uji Koin Volume Sepi / Rendah (Low Volume 0.20 - 0.59 SOL)
  const lowCurve = {
    priceInSol: 0.00000003,
    marketCapSol: 30,
    progressPercent: 0.4,
    realSolCollected: 0.35, // 0.35 SOL
    devHoldingPct: 6.0,
    isComplete: false,
  };
  const lowEval = evaluateVolumeMetrics(lowCurve);
  if (lowEval.metrics.volumeTier !== "LOW" || lowEval.metrics.isVolumeHealthy) {
    throw new Error("Koin dengan 0.35 SOL seharusnya berstatus LOW dan gagal ambang batas 0.60 SOL");
  }
  console.log("✅ 2. Filter Koin Volume Rendah (< 0.60 SOL): PASS");

  // 3. Uji Koin Volume Sehat (Healthy Volume 0.60 - 1.99 SOL)
  const healthyCurve = {
    priceInSol: 0.000000035,
    marketCapSol: 35,
    progressPercent: 1.2,
    realSolCollected: 0.95, // 0.95 SOL
    devHoldingPct: 8.5,
    isComplete: false,
  };
  const healthyEval = evaluateVolumeMetrics(healthyCurve);
  if (healthyEval.metrics.volumeTier !== "HEALTHY" || !healthyEval.metrics.isVolumeHealthy || healthyEval.metrics.isVolumeSurge) {
    throw new Error("Koin dengan 0.95 SOL seharusnya berstatus HEALTHY");
  }
  console.log("✅ 3. Validasi Koin Volume Sehat (0.95 SOL): PASS");

  // 4. Uji Koin Volume Surge (Ledakan Momentum Beli Masif >= 2.0 SOL)
  const surgeCurve = {
    priceInSol: 0.00000005,
    marketCapSol: 50,
    progressPercent: 3.5,
    realSolCollected: 2.65, // 2.65 SOL volume terkumpul
    devHoldingPct: 8.0,
    isComplete: false,
  };
  const surgeEval = evaluateVolumeMetrics(surgeCurve);
  if (surgeEval.metrics.volumeTier !== "SURGE" || !surgeEval.metrics.isVolumeSurge) {
    throw new Error("Koin dengan 2.65 SOL seharusnya berstatus SURGE");
  }
  console.log("✅ 4. Deteksi Lonjakan Volume (Volume Surge >= 2.0 SOL): PASS");

  // 5. Uji Pengambilan Keputusan Sniper Strategy dengan Filter Volume
  // Kasus A: Koin dengan volume sepi (0.35 SOL) wajib di-SKIP
  const decisionSkip = evaluateSniperStrategy({
    tokenSecurity: {
      signature: "sig1",
      mint: "mint1",
      verdict: "ALLOW",
      score: 100,
      checks: [],
      reasons: [],
      assessedAt: Date.now(),
    },
    creator: {
      address: "dev1",
      balanceSol: 2.0,
      txCount: 50,
      walletAgeMinutes: 1000,
      isBurnerWallet: false,
    },
    bondingCurve: lowCurve,
    manipulation: {
      holderMetrics: { topHolderPct: 3, top5CombinedPct: 10, bondingCurvePct: 85, isCabalRisk: false },
      washTradingMetrics: { totalTx: 10, uniqueWallets: 8, uniqueWalletRatio: 0.8, isWashTrading: false },
      checks: [],
    },
    volume: lowEval.metrics,
  });
  if (decisionSkip.shouldSnipe) {
    throw new Error("Koin dengan volume sepi seharusnya ditolak!");
  }
  console.log("✅ 5. Abort Koin dengan Volume Rendah di Strategi: PASS");

  // Kasus B: Koin dengan Volume Surge (2.65 SOL) wajib masuk HIGH CONVICTION (0.03 SOL)
  const decisionSurge = evaluateSniperStrategy({
    tokenSecurity: {
      signature: "sig2",
      mint: "mint2",
      verdict: "ALLOW",
      score: 100,
      checks: [],
      reasons: [],
      assessedAt: Date.now(),
    },
    creator: {
      address: "dev2",
      balanceSol: 2.0,
      txCount: 50,
      walletAgeMinutes: 1000,
      isBurnerWallet: false,
    },
    bondingCurve: surgeCurve,
    manipulation: {
      holderMetrics: { topHolderPct: 3, top5CombinedPct: 10, bondingCurvePct: 85, isCabalRisk: false },
      washTradingMetrics: { totalTx: 10, uniqueWallets: 8, uniqueWalletRatio: 0.8, isWashTrading: false },
      checks: [],
    },
    volume: surgeEval.metrics,
  });
  if (!decisionSurge.shouldSnipe || !decisionSurge.isHighConviction || decisionSurge.recommendedBuySol !== 0.030) {
    throw new Error(`Volume Surge seharusnya memicu alokasi 0.030 SOL, didapat: ${decisionSurge.recommendedBuySol}`);
  }
  console.log("✅ 6. Sinyal Moon High Conviction (0.03 SOL) Terpicu saat Volume Surge: PASS");

  console.log("\n🎉 SEMUA 6/6 PENGUJIAN MODUL FILTER VOLUME LOLOS SEMPURNA!\n");
}

void runVolumeFilterTest();

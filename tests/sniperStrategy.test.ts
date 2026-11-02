import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSniperStrategy } from "../src/risk/sniperStrategy.js";
import type { RiskAssessment } from "../types.js";
import type { CreatorProfile } from "../src/risk/creatorAnalysis.js";
import type { BondingCurveMetrics } from "../src/risk/bondingCurve.js";
import type { ManipulationAnalysisResult } from "../src/risk/manipulationFilter.js";

const DUMMY_SECURITY_ALLOW: RiskAssessment = {
  signature: "sig1",
  mint: "mint1",
  verdict: "ALLOW",
  score: 0,
  checks: [],
  assessedAt: Date.now(),
  reasons: ["All supplied checks passed"],
};

const DUMMY_SECURITY_REJECT: RiskAssessment = {
  ...DUMMY_SECURITY_ALLOW,
  verdict: "REJECT",
  reasons: ["PermanentDelegate detected"],
};

const DUMMY_VETERAN_DEV: CreatorProfile = {
  address: "dev1",
  balanceSol: 2.5,
  txCount: 15,
  walletAgeMinutes: 600,
  isBurnerWallet: false,
};

const DUMMY_CURVE_EARLY: BondingCurveMetrics = {
  priceInSol: 2.8e-8,
  marketCapSol: 28.0,
  progressPercent: 2.5, // 2.5% progress (awal banget)
  realSolCollected: 2.1,
  isComplete: false,
};

const DUMMY_MANIPULATION_SAFE: ManipulationAnalysisResult = {
  holderMetrics: { topHolderPct: 1.5, top5CombinedPct: 4.8, bondingCurvePct: 82, isCabalRisk: false },
  washTradingMetrics: { totalTx: 12, uniqueWallets: 9, uniqueWalletRatio: 0.75, isWashTrading: false },
  checks: [],
};

test("Strategi Sniper: Koin Sempurna (Prime Gem Candidate)", () => {
  const decision = evaluateSniperStrategy({
    tokenSecurity: DUMMY_SECURITY_ALLOW,
    creator: DUMMY_VETERAN_DEV,
    bondingCurve: DUMMY_CURVE_EARLY,
    manipulation: DUMMY_MANIPULATION_SAFE,
  });

  console.log("   Decision Should Snipe :", decision.shouldSnipe);
  console.log("   Confidence Score      :", decision.confidenceScore);
  console.log("   Recommended Buy       :", decision.recommendedBuySol, "SOL");
  console.log("   Entry Price           :", decision.entryPriceSol);
  console.log("   TP1 Target (+50%)     :", decision.targets.takeProfit1Price);
  console.log("   SL Target (-15%)      :", decision.targets.stopLossPrice);

  assert.equal(decision.shouldSnipe, true);
  assert.equal(decision.confidenceScore, 100);
  assert.equal(decision.recommendedBuySol, 0.1);
  assert.equal(decision.abortReasons.length, 0);
  assert.ok(decision.targets.takeProfit1Price > decision.entryPriceSol);
  assert.ok(decision.targets.stopLossPrice < decision.entryPriceSol);
});

test("Strategi Sniper: Tolak Token Berbahaya / Honeypot (Security Reject)", () => {
  const decision = evaluateSniperStrategy({
    tokenSecurity: DUMMY_SECURITY_REJECT,
    creator: DUMMY_VETERAN_DEV,
    bondingCurve: DUMMY_CURVE_EARLY,
    manipulation: DUMMY_MANIPULATION_SAFE,
  });

  assert.equal(decision.shouldSnipe, false);
  assert.equal(decision.recommendedBuySol, 0);
  assert.ok(decision.abortReasons.some(r => r.includes("Keamanan token tidak lolos")));
});

test("Strategi Sniper: Tolak Token Terlambat (Curve Progress > 20%)", () => {
  const decision = evaluateSniperStrategy({
    tokenSecurity: DUMMY_SECURITY_ALLOW,
    creator: DUMMY_VETERAN_DEV,
    bondingCurve: { ...DUMMY_CURVE_EARLY, progressPercent: 45.0 }, // Sudah 45%
    manipulation: DUMMY_MANIPULATION_SAFE,
  });

  assert.equal(decision.shouldSnipe, false);
  assert.ok(decision.abortReasons.some(r => r.includes("Progress kurva sudah 45%")));
});

test("Strategi Sniper: Tolak Token Sindikat Cabal (Holder Dump Risk)", () => {
  const decision = evaluateSniperStrategy({
    tokenSecurity: DUMMY_SECURITY_ALLOW,
    creator: DUMMY_VETERAN_DEV,
    bondingCurve: DUMMY_CURVE_EARLY,
    manipulation: {
      ...DUMMY_MANIPULATION_SAFE,
      holderMetrics: { topHolderPct: 12.0, top5CombinedPct: 25.0, bondingCurvePct: 65, isCabalRisk: true },
    },
  });

  assert.equal(decision.shouldSnipe, false);
  assert.ok(decision.abortReasons.some(r => r.includes("Konsentrasi holder berbahaya")));
});

test("Strategi Sniper: Tolak Token Fake Volume / Wash Trading", () => {
  const decision = evaluateSniperStrategy({
    tokenSecurity: DUMMY_SECURITY_ALLOW,
    creator: DUMMY_VETERAN_DEV,
    bondingCurve: DUMMY_CURVE_EARLY,
    manipulation: {
      ...DUMMY_MANIPULATION_SAFE,
      washTradingMetrics: { totalTx: 25, uniqueWallets: 3, uniqueWalletRatio: 0.12, isWashTrading: true },
    },
  });

  assert.equal(decision.shouldSnipe, false);
  assert.ok(decision.abortReasons.some(r => r.includes("wash trading")));
});
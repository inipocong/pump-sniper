import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateHolderConcentration,
  evaluateWashTrading,
} from "../src/risk/manipulationFilter.js";
import type { TokenLargestAccount } from "../src/risk/solanaRpc.js";

const DUMMY_CURVE = "CurveAddress111111111111111111111111111111";

test("Filter Manipulasi: Distribusi Organik & Aman (Safe Token)", () => {
  const holders: TokenLargestAccount[] = [
    { address: DUMMY_CURVE, amount: "793100000000000", decimals: 6, uiAmount: 793100000, uiAmountString: "793100000" }, // 79.3%
    { address: "buyer_1", amount: "15000000000000", decimals: 6, uiAmount: 15000000, uiAmountString: "15000000" },   // 1.5%
    { address: "buyer_2", amount: "12000000000000", decimals: 6, uiAmount: 12000000, uiAmountString: "12000000" },   // 1.2%
    { address: "buyer_3", amount: "10000000000000", decimals: 6, uiAmount: 10000000, uiAmountString: "10000000" },   // 1.0%
    { address: "buyer_4", amount: "8000000000000", decimals: 6, uiAmount: 8000000, uiAmountString: "8000000" },     // 0.8%
    { address: "buyer_5", amount: "5000000000000", decimals: 6, uiAmount: 5000000, uiAmountString: "5000000" },     // 0.5%
  ];

  const { metrics, checks } = evaluateHolderConcentration(holders, DUMMY_CURVE);

  console.log("   Safe Top 1 Holder :", metrics.topHolderPct, "%");
  console.log("   Safe Top 5 Sum    :", metrics.top5CombinedPct, "%");
  console.log("   Is Cabal Risk?    :", metrics.isCabalRisk);

  assert.equal(metrics.isCabalRisk, false);
  assert.equal(metrics.topHolderPct, 1.5);
  assert.equal(metrics.top5CombinedPct, 5.0);

  for (const c of checks) {
    assert.equal(c.passed, true, `Check ${c.name} harus lolos`);
  }
});

test("Filter Manipulasi: Whale Tunggal Terlalu Besar (Whale Dump Risk)", () => {
  const holders: TokenLargestAccount[] = [
    { address: DUMMY_CURVE, amount: "750000000000000", decimals: 6, uiAmount: 750000000, uiAmountString: "750000000" },
    { address: "whale_alpha", amount: "110000000000000", decimals: 6, uiAmount: 110000000, uiAmountString: "110000000" }, // 11%
    { address: "buyer_2", amount: "10000000000000", decimals: 6, uiAmount: 10000000, uiAmountString: "10000000" },
  ];

  const { metrics, checks } = evaluateHolderConcentration(holders, DUMMY_CURVE);

  console.log("   Whale Top 1 Pct   :", metrics.topHolderPct, "%");
  console.log("   Is Cabal Risk?    :", metrics.isCabalRisk);

  assert.equal(metrics.isCabalRisk, true);
  const whaleCheck = checks.find(c => c.name === "holder_whale_concentration");
  assert.equal(whaleCheck?.passed, false);
  assert.equal(whaleCheck?.severity, "CRITICAL");
});

test("Filter Manipulasi: Sindikat Cabal Bundling (Top 5 Menguasai > 18%)", () => {
  const holders: TokenLargestAccount[] = [
    { address: DUMMY_CURVE, amount: "700000000000000", decimals: 6, uiAmount: 700000000, uiAmountString: "700000000" },
    { address: "cabal_1", amount: "45000000000000", decimals: 6, uiAmount: 45000000, uiAmountString: "45000000" }, // 4.5%
    { address: "cabal_2", amount: "45000000000000", decimals: 6, uiAmount: 45000000, uiAmountString: "45000000" }, // 4.5%
    { address: "cabal_3", amount: "45000000000000", decimals: 6, uiAmount: 45000000, uiAmountString: "45000000" }, // 4.5%
    { address: "cabal_4", amount: "45000000000000", decimals: 6, uiAmount: 45000000, uiAmountString: "45000000" }, // 4.5%
    { address: "cabal_5", amount: "45000000000000", decimals: 6, uiAmount: 45000000, uiAmountString: "45000000" }, // 4.5%
  ];

  const { metrics, checks } = evaluateHolderConcentration(holders, DUMMY_CURVE);

  console.log("   Cabal Top 5 Sum   :", metrics.top5CombinedPct, "%");
  console.log("   Is Cabal Risk?    :", metrics.isCabalRisk);

  assert.equal(metrics.isCabalRisk, true);
  const cabalCheck = checks.find(c => c.name === "holder_cabal_distribution");
  assert.equal(cabalCheck?.passed, false);
  assert.equal(cabalCheck?.severity, "HIGH");
});

test("Filter Manipulasi: Deteksi Fake Volume / Wash Trading", () => {
  const signers = [
    "bot_wallet_1", "bot_wallet_2", "bot_wallet_3",
    "bot_wallet_1", "bot_wallet_2", "bot_wallet_3",
    "bot_wallet_1", "bot_wallet_2", "bot_wallet_3",
    "bot_wallet_1", "bot_wallet_2", "bot_wallet_3",
    "bot_wallet_1", "bot_wallet_2", "bot_wallet_3",
    "bot_wallet_1", "bot_wallet_2", "bot_wallet_3",
    "bot_wallet_1", "bot_wallet_2",
  ];

  const { metrics, checks } = evaluateWashTrading(signers);

  console.log("   Wash Total Tx     :", metrics.totalTx);
  console.log("   Wash Unique Wallets:", metrics.uniqueWallets);
  console.log("   Wash Ratio        :", metrics.uniqueWalletRatio);
  console.log("   Is Wash Trading?  :", metrics.isWashTrading);

  assert.equal(metrics.isWashTrading, true);
  assert.equal(metrics.uniqueWallets, 3);
  assert.ok(metrics.uniqueWalletRatio < 0.45);

  const washCheck = checks.find(c => c.name === "wash_trading_detection");
  assert.equal(washCheck?.passed, false);
  assert.equal(washCheck?.severity, "HIGH");
});
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db.js";
import { PaperTrader } from "../src/paper/paperTrader.js";
import type { SniperDecision } from "../src/risk/sniperStrategy.js";

const DECISION: SniperDecision = {
  shouldSnipe: true,
  confidenceScore: 90,
  recommendedBuySol: 0.015,
  entryPriceSol: 1.0e-7,
  targets: {
    takeProfit1Price: 1.5e-7, // +50%
    takeProfit2Price: 2.0e-7, // +100%
    takeProfit3Price: 3.0e-7, // +200%
    stopLossPrice: 0.88e-7,   // -12% awal
  },
  reasons: ["Strong candidate"],
  abortReasons: [],
};

test("Partial Take Profit: Eksekusi TP1 (+50%), Jual 50% & SL Naik ke Breakeven", async () => {
  const store = new Store(":memory:");
  await store.init();

  const trader = new PaperTrader(store, { initialVirtualBalanceSol: 0.0857 });

  const trade = trader.executeVirtualBuy("MINT_TP_01", "TEST_GEM", DECISION);
  assert.ok(trade);
  assert.equal(trade.tokensBought, 150000);
  assert.equal(trade.tokensRemaining, 150000);
  assert.equal(trade.stage, 0);

  // 1. Harga naik ke level TP1 (+50% = 1.5e-7)
  const tp1Result = trader.updatePositionPrice("MINT_TP_01", 1.5e-7);
  assert.equal(tp1Result.action, "TP1_HIT");
  assert.ok(tp1Result.partialTrade);
  assert.equal(tp1Result.partialTrade.stage, 1);
  assert.equal(tp1Result.partialTrade.tokensRemaining, 75000); // 50% tersisa
  assert.ok(tp1Result.partialTrade.realizedPnlSol > 0.009); // Kas kembali masuk

  // SL naik ke Breakeven (+2.5% dari entry)
  assert.ok(tp1Result.partialTrade.slPrice > 1.0e-7);

  // 2. Koin kena dump kembali turun ke SL Breakeven
  const slResult = trader.updatePositionPrice("MINT_TP_01", tp1Result.partialTrade.slPrice);
  assert.equal(slResult.action, "SL_HIT");
  assert.ok(slResult.closedTrade);
  assert.equal(slResult.closedTrade.status, "TP_HIT");
  assert.ok((slResult.closedTrade.pnlSol ?? 0) > 0, "Trade harus tetap profit meskipun sisa token kena SL breakeven!");

  store.close();
});

test("Partial Take Profit: Eksekusi Penuh Sampai TP3 (+200% / 3X)", async () => {
  const store = new Store(":memory:");
  await store.init();

  const trader = new PaperTrader(store, { initialVirtualBalanceSol: 0.0857 });

  const trade = trader.executeVirtualBuy("MINT_TP_02", "RUNNER", DECISION);
  assert.ok(trade);

  // 1. Hit TP1 (+50%)
  const tp1 = trader.updatePositionPrice("MINT_TP_02", 1.5e-7);
  assert.equal(tp1.action, "TP1_HIT");
  assert.equal(tp1.partialTrade?.tokensRemaining, 75000);

  // 2. Hit TP2 (+100%)
  const tp2 = trader.updatePositionPrice("MINT_TP_02", 2.0e-7);
  assert.equal(tp2.action, "TP2_HIT");
  assert.equal(tp2.partialTrade?.tokensRemaining, 37500); // 25% tersisa
  assert.equal(tp2.partialTrade?.slPrice, 1.5e-7); // SL dikunci di level TP1

  // 3. Hit TP3 (+200%) -> Full Exit!
  const tp3 = trader.updatePositionPrice("MINT_TP_02", 3.0e-7);
  assert.equal(tp3.action, "TP3_HIT");
  assert.ok(tp3.closedTrade);
  assert.equal(tp3.closedTrade.status, "TP_HIT");
  assert.ok((tp3.closedTrade.pnlSol ?? 0) > 0.010, "Harus cuan tebal > +70%!");

  console.log("   Cuan Tebal TP3:", tp3.closedTrade.pnlSol, "SOL (" + tp3.closedTrade.pnlPercent + "%)");

  store.close();
});

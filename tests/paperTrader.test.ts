import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db.js";
import { PaperTrader } from "../src/paper/paperTrader.js";
import type { SniperDecision } from "../src/risk/sniperStrategy.js";

const DUMMY_DECISION: SniperDecision = {
  shouldSnipe: true,
  confidenceScore: 95,
  recommendedBuySol: 0.1,
  entryPriceSol: 2.8e-8,
  targets: {
    takeProfit1Price: 4.2e-8, // +50%
    takeProfit2Price: 5.6e-8,
    takeProfit3Price: 8.4e-8,
    stopLossPrice: 2.38e-8,   // -15%
  },
  reasons: ["Prime gem candidate"],
  abortReasons: [],
};

test("Paper Trader: Simulasi Beli Virtual Berhasil", async () => {
  const store = new Store();
  await store.init();

  const trader = new PaperTrader(store, { initialVirtualBalanceSol: 10.0 });
  assert.equal(trader.getVirtualBalance(), 10.0);

  // Eksekusi beli virtual 0.1 SOL
  const trade = trader.executeVirtualBuy("MINT_GEM_01", "GEM1", DUMMY_DECISION);
  assert.ok(trade, "Trade harus berhasil dibuat");
  assert.equal(trade.status, "OPEN");
  assert.equal(trade.costSol, 0.1);
  assert.equal(trader.getVirtualBalance(), 9.9);

  // Verifikasi posisi terbuka di SQLite
  const openTrades = store.getOpenPaperTrades();
  assert.ok(openTrades.some(t => t.id === trade.id));

  store.close();
});

test("Paper Trader: Auto Take-Profit (+50% Profit Realized)", async () => {
  const store = new Store();
  await store.init();

  const trader = new PaperTrader(store, { initialVirtualBalanceSol: 10.0 });
  const trade = trader.executeVirtualBuy("MINT_GEM_02", "GEM2", DUMMY_DECISION);
  assert.ok(trade);
  assert.equal(trader.getVirtualBalance(), 9.9);

  // Harga naik ke level TP1 (+50% = 4.2e-8)
  const result = trader.updatePositionPrice("MINT_GEM_02", 4.2e-8);
  assert.equal(result.action, "TP_HIT");
  assert.ok(result.closedTrade);
  assert.equal(result.closedTrade.status, "TP_HIT");
  assert.ok((result.closedTrade.pnlSol ?? 0) > 0.049); // Cuan ~0.05 SOL

  console.log("   Saldo setelah TP:", trader.getVirtualBalance(), "SOL");
  assert.ok(trader.getVirtualBalance() >= 10.04);

  store.close();
});

test("Paper Trader: Auto Stop-Loss (-15% Cut Loss Terkendali)", async () => {
  const store = new Store();
  await store.init();

  const trader = new PaperTrader(store, { initialVirtualBalanceSol: 10.0 });
  const trade = trader.executeVirtualBuy("MINT_GEM_03", "GEM3", DUMMY_DECISION);
  assert.ok(trade);

  // Harga jatuh ke batas SL (-15% = 2.38e-8)
  const result = trader.updatePositionPrice("MINT_GEM_03", 2.35e-8);
  assert.equal(result.action, "SL_HIT");
  assert.ok(result.closedTrade);
  assert.equal(result.closedTrade.status, "SL_HIT");
  assert.ok((result.closedTrade.pnlSol ?? 0) < 0); // Rugi terkontrol ~ -0.015 SOL

  console.log("   Saldo setelah SL:", trader.getVirtualBalance(), "SOL");

  const summary = trader.getPortfolioSummary();
  console.log("   Portofolio Win Rate:", summary.winRate);
  console.log("   Total PnL SOL       :", summary.totalPnlSol);

  store.close();
});
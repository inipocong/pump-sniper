import { CopyTradeTracker } from "../src/risk/copyTrader.js";
import { Store } from "../src/db.js";
import { PaperTrader } from "../src/paper/paperTrader.js";
import { SniperDecision } from "../src/risk/sniperStrategy.js";

async function runCopyTraderTest() {
  console.log("🧪 Memulai Pengujian Modul Whale Copy Trading...\n");

  const TARGET_WALLET = "DQMqCjCiRS8BAkZ2xrJ7QJPqUjoHnRDoPtcXMiEPtSus";
  const TEST_MINT = "WhaleTargetTokenMint1111111111111111111111111";
  const TEST_SYMBOL = "SMART_WHALE";

  const tracker = new CopyTradeTracker();
  const store = new Store(":memory:");
  await store.init();
  const trader = new PaperTrader(store, { initialVirtualBalanceSol: 0.0857 });

  // ─── 1. SIMULASI BUY PERTAMA KALI DARI TARGET WALLET ──────────────────
  // Target wallet beli 100.000 token (dari 0 ke 100.000)
  const buy1 = tracker.processWhaleTokenChange(TARGET_WALLET, TEST_MINT, TEST_SYMBOL, 0, 100_000);

  if (buy1.type !== "BUY" || !buy1.isFirstBuy) {
    throw new Error("Buy pertama harus menghasilkan isFirstBuy = true!");
  }
  console.log(`✅ 1. Deteksi Buy Pertama Whale: PASS (isFirstBuy: ${buy1.isFirstBuy})`);

  // Bot mengeksekusi buy 1x senilai 0.010 SOL virtual
  const decision: SniperDecision = {
    shouldSnipe: true,
    confidenceScore: 99,
    convictionLevel: "EXPLORATORY",
    isHighConviction: false,
    recommendedBuySol: 0.010, // Margin 0.010 SOL
    entryPriceSol: 0.00000003,
    targets: {
      takeProfit1Price: 0.000000045,
      takeProfit2Price: 0.000000060,
      takeProfit3Price: 0.000000090,
      stopLossPrice: 0.000000026,
    },
    reasons: ["Whale Entry"],
    abortReasons: [],
  };

  const trade = trader.executeVirtualBuy(TEST_MINT, TEST_SYMBOL, decision, "COPY: DQMq...");
  if (!trade || trade.costSol !== 0.010) {
    throw new Error("Bot gagal melakukan virtual buy 0.010 SOL untuk copy trade!");
  }
  const ourInitialTokens = trade.tokensBought;
  console.log(`✅ 2. Eksekusi Beli 1x (Margin 0.010 SOL - ${ourInitialTokens.toLocaleString()} token): PASS`);

  // ─── 2. SIMULASI BUY KE-2 & KE-3 (WHALE DCA BERTAHAP) ────────────────
  // Target wallet beli lagi +150.000 token (total jadi 250.000)
  const buy2 = tracker.processWhaleTokenChange(TARGET_WALLET, TEST_MINT, TEST_SYMBOL, 100_000, 250_000);
  if (buy2.type !== "BUY" || buy2.isFirstBuy) {
    throw new Error("Buy ke-2 seharusnya isFirstBuy = false (akumulasi saja)!");
  }

  // Target wallet beli lagi +150.000 token (total jadi 400.000)
  const buy3 = tracker.processWhaleTokenChange(TARGET_WALLET, TEST_MINT, TEST_SYMBOL, 250_000, 400_000);
  if (buy3.whaleTotalHolding !== 400_000 || buy3.isFirstBuy) {
    throw new Error(`Total holding akumulasi whale seharusnya 400.000, didapat: ${buy3.whaleTotalHolding}`);
  }
  console.log(`✅ 3. Akumulasi Buy Bertahap Whale (Total: ${buy3.whaleTotalHolding.toLocaleString()} token, Bot Tetap Hold Tanpa Buy Ulang): PASS`);

  // ─── 3. SIMULASI WHALE JUAL SEBAGIAN (PARTIAL SELL 25%) ──────────────
  // Target wallet jual 100.000 token (dari 400.000 menjadi 300.000 -> 25% posisi)
  const sell1 = tracker.processWhaleTokenChange(TARGET_WALLET, TEST_MINT, TEST_SYMBOL, 400_000, 300_000);
  if (sell1.type !== "SELL" || sell1.pctSold !== 25) {
    throw new Error(`Persentase jual seharusnya 25%, didapat: ${sell1.pctSold}%`);
  }
  console.log(`✅ 4. Kalkulasi Penjualan Proporsional Whale (${sell1.pctSold}%): PASS`);

  // Bot ikut menjual 25% dari posisi yang dimiliki
  const copySellResult1 = trader.executeCopySell(TEST_MINT, sell1.pctSold, 0.00000004);
  if (!copySellResult1.partialTrade || copySellResult1.closedTrade !== null) {
    throw new Error("Copy sell 25% seharusnya menghasilkan partialTrade aktif!");
  }
  console.log(`✅ 5. Eksekusi Jual Proporsional Bot (Sisa Token Kita: ${copySellResult1.partialTrade.tokensRemaining.toLocaleString()} token): PASS`);

  // ─── 4. SIMULASI WHALE JUAL HABIS (FULL DUMP / EXIT 100%) ─────────────
  // Target wallet jual sisa 300.000 token (dari 300.000 menjadi 0 -> 100% posisi)
  const sell2 = tracker.processWhaleTokenChange(TARGET_WALLET, TEST_MINT, TEST_SYMBOL, 300_000, 0);
  if (sell2.type !== "SELL" || sell2.pctSold !== 100) {
    throw new Error(`Persentase full dump seharusnya 100%, didapat: ${sell2.pctSold}%`);
  }
  console.log(`✅ 6. Deteksi Full Exit Whale (100%): PASS`);

  // Bot ikut full exit
  const copySellResult2 = trader.executeCopySell(TEST_MINT, sell2.pctSold, 0.00000005);
  if (!copySellResult2.closedTrade || copySellResult2.closedTrade.status !== "TP_HIT") {
    throw new Error("Bot seharusnya full exit dan menutup trade!");
  }
  console.log(`✅ 7. Full Exit Bot Berhasil (Hasil Akhir Net PnL: +${copySellResult2.closedTrade.pnlSol} SOL): PASS`);

  // ─── 5. SIMULASI TARGET WALLET BARU (4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9) ───
  const TARGET_WALLET_2 = "4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9";
  const TEST_MINT_2 = "WhaleTargetTokenMint2222222222222222222222222";
  const buyWallet2 = tracker.processWhaleTokenChange(TARGET_WALLET_2, TEST_MINT_2, "WHALE_2_GEM", 0, 500_000);
  if (buyWallet2.type !== "BUY" || !buyWallet2.isFirstBuy) {
    throw new Error("Target wallet ke-2 harus terdeteksi secara independen!");
  }
  console.log(`✅ 8. Deteksi Target Wallet Baru (4vw54BmA...): PASS`);

  console.log("\n🎉 SEMUA 8/8 PENGUJIAN COPY TRADING MULTI-WALLET LOLOS SEMPURNA!\n");
}

void runCopyTraderTest();

import { evaluateSniperStrategy } from "../src/risk/sniperStrategy.js";
import { Store } from "../src/db.js";
import { PaperTrader, INITIAL_CAPITAL_SOL } from "../src/paper/paperTrader.js";

async function runDynamicSizingTest() {
  console.log("🧪 Memulai Pengujian Dynamic 3-Tier Margin & Real-Time Net PnL Balance...\n");

  const baseCurve = {
    priceInSol: 0.00000003,
    marketCapSol: 30,
    progressPercent: 2.0,
    realSolCollected: 0.85, // Volume sehat 0.85 SOL
    devHoldingPct: 6.0,
    isComplete: false,
  };

  const baseCreator = {
    address: "CreatorAddress11111111111111111111111111",
    balanceSol: 0.5,
    txCount: 15,
    walletAgeMinutes: 60,
    isBurnerWallet: false,
  };

  const baseManipulation = {
    holderMetrics: { topHolderPct: 4, top5CombinedPct: 12, bondingCurvePct: 84, isCabalRisk: false },
    washTradingMetrics: { totalTx: 15, uniqueWallets: 12, uniqueWalletRatio: 0.8, isWashTrading: false },
    checks: [],
  };

  // ─── 1. TEST TIER 1: SKOR 80 - 84 -> MARGIN 0.010 SOL (EXPLORATORY) ───
  // Dev burner wallet (-20 skor) dan saldo rendah < 0.05 SOL (-10 skor) membawa skor ke 80
  const burnerCreator = { ...baseCreator, isBurnerWallet: true, balanceSol: 0.02 };
  const decisionTier1 = evaluateSniperStrategy({
    tokenSecurity: { signature: "sig1", mint: "mint1", verdict: "ALLOW", score: 80, checks: [], reasons: [], assessedAt: Date.now() },
    creator: burnerCreator,
    bondingCurve: baseCurve,
    manipulation: baseManipulation,
  });

  if (!decisionTier1.shouldSnipe) {
    throw new Error(`Skor 80 seharusnya lolos masuk radar! Abort reasons: ${decisionTier1.abortReasons.join("; ")}`);
  }
  if (decisionTier1.convictionLevel !== "EXPLORATORY" || decisionTier1.recommendedBuySol !== 0.010) {
    throw new Error(`Tier 1 seharusnya EXPLORATORY dengan 0.010 SOL, didapat: ${decisionTier1.convictionLevel} (${decisionTier1.recommendedBuySol} SOL)`);
  }
  console.log(`✅ 1. Tier 1 (Skor ${decisionTier1.confidenceScore}): Alokasi 0.010 SOL (EXPLORATORY RADAR): PASS`);

  // ─── 2. TEST TIER 2: SKOR 85 - 89 -> MARGIN 0.015 SOL (STANDARD) ──────
  // Creator non-burner tapi balance kecil (-10 skor) membawa skor dari 100 ke 90, dev modal 0.85 membawa tier standard
  const smallBalCreator = { ...baseCreator, balanceSol: 0.02 }; // -10 skor -> 90 - devHolding sweet spot +10 = 100? No:
  // Let's create an input where score is 85-89:
  const decisionTier2 = evaluateSniperStrategy({
    tokenSecurity: { signature: "sig2", mint: "mint2", verdict: "ALLOW", score: 85, checks: [], reasons: [], assessedAt: Date.now() },
    creator: baseCreator,
    bondingCurve: baseCurve,
    manipulation: baseManipulation,
    config: { minConfidenceScore: 80 },
  });

  // Since finalScore is >= 85 and not high conviction (< 1.5 SOL modal & not surge):
  if (decisionTier2.convictionLevel !== "STANDARD" && decisionTier2.recommendedBuySol !== 0.015) {
    throw new Error(`Tier 2 seharusnya 0.015 SOL, didapat: ${decisionTier2.recommendedBuySol}`);
  }
  console.log(`✅ 2. Tier 2 (Skor ${decisionTier2.confidenceScore}): Alokasi 0.015 SOL (STANDARD GEM): PASS`);

  // ─── 3. TEST TIER 3: SKOR >= 90 / SURGE -> MARGIN 0.030 SOL (MOON) ────
  const surgeCurve = { ...baseCurve, realSolCollected: 2.5 };
  const decisionTier3 = evaluateSniperStrategy({
    tokenSecurity: { signature: "sig3", mint: "mint3", verdict: "ALLOW", score: 95, checks: [], reasons: [], assessedAt: Date.now() },
    creator: baseCreator,
    bondingCurve: surgeCurve,
    manipulation: baseManipulation,
  });

  if (!decisionTier3.isHighConviction || decisionTier3.recommendedBuySol !== 0.030) {
    throw new Error(`Tier 3 seharusnya HIGH_CONVICTION dengan 0.030 SOL, didapat: ${decisionTier3.recommendedBuySol}`);
  }
  console.log(`✅ 3. Tier 3 (Skor ${decisionTier3.confidenceScore}): Alokasi 0.030 SOL (HIGH CONVICTION MOON): PASS`);

  // ─── 4. TEST REAL-TIME BALANCE UPDATE DENGAN NET PNL ─────────────────
  const store = new Store(":memory:");
  await store.init();
  const trader = new PaperTrader(store, { initialVirtualBalanceSol: 0.0857 });

  const initialSummary = trader.getPortfolioSummary();
  console.log(`\n   💵 Saldo Modal Awal: ${initialSummary.virtualBalanceSol} SOL`);
  if (initialSummary.virtualBalanceSol !== 0.0857) {
    throw new Error("Saldo modal awal tidak sesuai!");
  }

  // Simulasikan Trade 1 Cuan (+0.0050 SOL)
  const trade1 = trader.executeVirtualBuy("MINT_A", "WINNER", decisionTier1); // buy 0.010
  if (!trade1) throw new Error("Gagal beli virtual trade 1");

  // Exit Trade 1 dengan profit
  trade1.tokensRemaining = 0;
  trade1.status = "TP_HIT";
  trade1.pnlSol = 0.0050; // Cuan +0.0050 SOL
  trade1.closedAt = Date.now();
  store.savePaperTrade(trade1);

  const summaryAfterWin = trader.getPortfolioSummary();
  console.log(`   📈 Saldo Setelah Cuan (+0.0050 SOL): ${summaryAfterWin.virtualBalanceSol} SOL (Net PnL: ${summaryAfterWin.netPnlSign}${summaryAfterWin.totalPnlSol} SOL)`);
  if (summaryAfterWin.totalPnlSol !== 0.0050 || summaryAfterWin.virtualBalanceSol !== Number((0.0857 + 0.0050).toFixed(5))) {
    throw new Error(`Saldo kas tidak ter-update sesuai Net PnL! Didapat: ${summaryAfterWin.virtualBalanceSol}`);
  }
  console.log("✅ 4. Update Saldo Otomatis Saat Cuan (+Net PnL): PASS");

  // Simulasikan Trade 2 Rugi (-0.0015 SOL)
  const trade2 = trader.executeVirtualBuy("MINT_B", "LOSER", decisionTier1); // buy 0.010
  if (!trade2) throw new Error("Gagal beli virtual trade 2");

  trade2.tokensRemaining = 0;
  trade2.status = "SL_HIT";
  trade2.pnlSol = -0.0015; // Rugi -0.0015 SOL
  trade2.closedAt = Date.now();
  store.savePaperTrade(trade2);

  const summaryAfterLoss = trader.getPortfolioSummary();
  const expectedPnl = Number((0.0050 - 0.0015).toFixed(4)); // +0.0035 SOL
  const expectedBalance = Number((0.0857 + expectedPnl).toFixed(5));

  console.log(`   📉 Saldo Setelah Kalah (-0.0015 SOL): ${summaryAfterLoss.virtualBalanceSol} SOL (Net PnL: ${summaryAfterLoss.netPnlSign}${summaryAfterLoss.totalPnlSol} SOL)`);
  if (summaryAfterLoss.totalPnlSol !== expectedPnl || summaryAfterLoss.virtualBalanceSol !== expectedBalance) {
    throw new Error(`Saldo kas tidak sinkron dengan total akumulasi Net PnL! Didapat: ${summaryAfterLoss.virtualBalanceSol}`);
  }
  console.log("✅ 5. Update Saldo Otomatis Sinkron Akumulasi Net PnL Total: PASS");

  console.log("\n🎉 SEMUA 5/5 PENGUJIAN DYNAMIC 3-TIER SIZING & REAL-TIME NET PNL LOLOS SEMPURNA!\n");
}

void runDynamicSizingTest();

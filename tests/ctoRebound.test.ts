import { CtoReboundTracker } from "../src/risk/ctoTracker.js";
import { evaluateSniperStrategy } from "../src/risk/sniperStrategy.js";

async function runCtoTest() {
  console.log("🧪 Memulai Pengujian Modul CTO Rebound Sniper...\n");

  const tracker = new CtoReboundTracker();
  const testMint = "CTOTestMint111111111111111111111111111111111";
  const testCreator = "DevJeeterWallet111111111111111111111111111111";
  const testCurve = "CurveAccount11111111111111111111111111111111";

  // 1. Simulasikan Dev buang semua barang (Dev Jeet event)
  const dipPrice = 0.000000030; // 3.0e-8 SOL
  const initialSolReserves = 5.0; // 5 SOL di kurva setelah dev buang barang

  tracker.recordDevJeet(testMint, "JEETCOIN", testCreator, dipPrice, testCurve, initialSolReserves);

  if (!tracker.isWatching(testMint)) {
    throw new Error("Gagal mencatat dev jeet ke dalam watchlist CTO");
  }
  console.log("✅ 1. Deteksi Dev Jeet & Pendaftaran ke Watchlist: PASS");

  // 2. Evaluasi rebound saat harga masih di dasar (belum memantul)
  const noBounce = tracker.evaluateRebound(testMint, 0.000000031, 5.0);
  if (noBounce !== null) {
    throw new Error("Rebound seharusnya belum terkonfirmasi jika belum memantul signifikan");
  }
  console.log("✅ 2. Filter False Positive (Harga belum memantul): PASS");

  // 3. Simulasikan V-Shape Recovery setelah jeda beberapa detik:
  // Harga memantul +20% (dari 3.0e-8 ke 3.6e-8) dan ada net buyer masuk (cadangan SOL naik dari 5.0 ke 5.3 SOL)
  // Untuk keperluan unit test, kita majukan dipTimestamp agar melewati jeda 6 detik
  const watchedItem = (tracker as any).watchedTokens.get(testMint);
  watchedItem.dipTimestamp = Date.now() - 8000; // 8 detik yang lalu

  const reboundPrice = 0.000000036; // +20% bounce
  const currentSolReserves = 5.3; // +6% SOL inflow absorption
  const reboundResult = tracker.evaluateRebound(testMint, reboundPrice, currentSolReserves);

  if (!reboundResult || !reboundResult.isConfirmed) {
    throw new Error("Rebound seharusnya terkonfirmasi saat harga +20% dan ada inflow SOL!");
  }
  console.log(`✅ 3. Konfirmasi V-Shape Recovery (+${reboundResult.reboundPercent}%): PASS`);

  // 4. Evaluasi Sniper Strategy untuk CTO Rebound
  const decision = evaluateSniperStrategy({
    tokenSecurity: {
      signature: "cto_sig",
      mint: testMint,
      verdict: "ALLOW",
      score: 95,
      checks: [],
      reasons: ["CTO Rebound Verified"],
      assessedAt: Date.now(),
    },
    creator: {
      address: testCreator,
      balanceSol: 0,
      txCount: 0,
      walletAgeMinutes: null,
      isBurnerWallet: false,
    },
    bondingCurve: {
      priceInSol: reboundPrice,
      marketCapSol: 36.0,
      progressPercent: 6.2,
      realSolCollected: currentSolReserves,
      devHoldingPct: 0.0, // Dev sudah bersih 0%
      isComplete: false,
    },
    manipulation: {
      holderMetrics: {
        topHolderPct: 4.5,
        top5CombinedPct: 14.0,
        bondingCurvePct: 81.5,
        isCabalRisk: false,
      },
      washTradingMetrics: {
        totalTx: 25,
        uniqueWallets: 20,
        uniqueWalletRatio: 0.8,
        isWashTrading: false,
      },
      checks: [],
    },
    isCtoRebound: true,
  });

  if (!decision.shouldSnipe) {
    throw new Error(`CTO Rebound gagal lolos strategy: ${decision.abortReasons.join("; ")}`);
  }
  if (!decision.isHighConviction) {
    throw new Error("CTO Rebound wajib diklasifikasikan sebagai HIGH CONVICTION!");
  }
  if (decision.recommendedBuySol !== 0.030) {
    throw new Error(`Alokasi beli seharusnya 0.030 SOL, didapat: ${decision.recommendedBuySol}`);
  }
  console.log(`✅ 4. Conviction Scaler (Alokasi 0.03 SOL & High Conviction Flag): PASS`);
  console.log(`       Target TP1 (+40%): ${decision.targets.takeProfit1Price}`);
  console.log(`       Target TP2 (+100%): ${decision.targets.takeProfit2Price}`);
  console.log(`       Target TP3 (+250%): ${decision.targets.takeProfit3Price}`);

  console.log("\n🎉 SEMUA 4/4 PENGUJIAN MODUL CTO REBOUND SNIPER LOLOS SEMPURNA!\n");
}

void runCtoTest();

import { Store } from "../src/db.js";
import { SolanaRpcClient } from "../src/risk/solanaRpc.js";
import { resolveTokenPriceAndMetadata } from "../src/risk/tokenPriceResolver.js";
import { INITIAL_CAPITAL_SOL, INITIAL_CAPITAL_USD, SOL_PRICE_USD } from "../src/paper/paperTrader.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const WHITE = "\x1b[37m";

const rpc = new SolanaRpcClient();

async function refreshDashboard() {
  const store = new Store();
  try {
    await store.init();
  } catch {
    return;
  }

  const openTrades = store.getOpenPaperTrades();
  const stats = store.getPaperTradeStats();
  const now = new Date().toTimeString().split(" ")[0];

  console.clear();

  // Dana yang terikat di posisi terbuka
  const openCommittedSol = openTrades.reduce((sum, t) => {
    const buyFee = (t.costSol * 0.01) + 0.0008;
    return sum + t.costSol + buyFee;
  }, 0);

  // Saldo kas standby & total nilai portofolio
  const cashBalanceSol = Number(Math.max(0, INITIAL_CAPITAL_SOL + stats.totalPnlSol - openCommittedSol).toFixed(5));
  const totalPortfolioSol = Number((cashBalanceSol + openCommittedSol).toFixed(5));
  const totalPortfolioUsd = (totalPortfolioSol * SOL_PRICE_USD).toFixed(2);
  const cashBalanceUsd = (cashBalanceSol * SOL_PRICE_USD).toFixed(2);

  const growthPercent = Number(((stats.totalPnlSol / INITIAL_CAPITAL_SOL) * 100).toFixed(2));
  const growthSign = stats.totalPnlSol >= 0 ? "+" : "";
  const growthColor = stats.totalPnlSol >= 0 ? GREEN : RED;

  const winRateStr = stats.totalTrades > 0
    ? ((stats.winCount / stats.totalTrades) * 100).toFixed(1) + "%"
    : "0%";

  console.log(CYAN + BOLD + "💼 ==================== DASHBOARD LIVE PORTOFOLIO ====================" + RESET);
  console.log("   ⏰ Terakhir Update   : " + DIM + now + RESET);
  console.log("   💵 Modal Awal        : " + WHITE + BOLD + INITIAL_CAPITAL_SOL + " SOL" + RESET + " (~$" + INITIAL_CAPITAL_USD.toFixed(2) + ")");
  console.log("   💰 Saldo Kas Standby : " + CYAN + BOLD + cashBalanceSol + " SOL" + RESET + " (~$" + cashBalanceUsd + ")");
  console.log("   💎 Total Portofolio  : " + BOLD + totalPortfolioSol + " SOL" + RESET + " (~$" + totalPortfolioUsd + ")");
  console.log("   🚀 Pertumbuhan Modal : " + growthColor + BOLD + growthSign + stats.totalPnlSol + " SOL (" + growthSign + growthPercent + "%)" + RESET);
  console.log("   ----------------------------------------------------------------------");
  console.log("   📊 Total Selesai     : " + BOLD + WHITE + stats.totalTrades + RESET + " trade");
  console.log("   🏆 Menang / Kalah    : " + GREEN + BOLD + stats.winCount + " Menang" + RESET + " | " + RED + BOLD + stats.lossCount + " Kalah" + RESET);
  console.log("   🎯 Win Rate          : " + BOLD + YELLOW + winRateStr + RESET);
  console.log("   💸 Net Realized PnL  : " + growthColor + BOLD + growthSign + stats.totalPnlSol + " SOL" + RESET);
  console.log(CYAN + "======================================================================" + RESET + "\n");

  if (openTrades.length === 0) {
    console.log("   " + DIM + "☕ Tidak ada koin yang sedang di-hold. Bot sedang mencari gem baru..." + RESET + "\n");
    store.close();
    return;
  }

  console.log(BOLD + "📌 POSISI YANG SEDANG DI-HOLD (" + openTrades.length + "/3 SLOT AKTIF):" + RESET + "\n");

  for (let i = 0; i < openTrades.length; i++) {
    const pos = openTrades[i];
    const holdSec = Math.floor((Date.now() - pos.openedAt) / 1000);

    let currentPrice = pos.entryPrice;
    let pnlPercent = 0;
    let displaySymbol = pos.symbol;

    try {
      const curveAddress = store.getBondingCurveByMint(pos.mint);
      const info = await resolveTokenPriceAndMetadata(rpc, pos.mint, curveAddress);
      if (info && info.priceInSol > 0) {
        currentPrice = info.priceInSol;
        pnlPercent = Number((((currentPrice - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2));
        if (info.symbol && info.symbol !== "WHALE_GEM" && pos.symbol === "WHALE_GEM") {
          displaySymbol = info.symbol;
          pos.symbol = info.symbol;
          store.savePaperTrade(pos);
        }
      }
    } catch {
      // Abaikan jika RPC sedang sibuk
    }

    const curPnlColor = pnlPercent >= 0 ? GREEN : RED;
    const curPnlSign = pnlPercent >= 0 ? "+" : "";
    const holdColor = holdSec >= 60 ? YELLOW : DIM;
    const timeoutText = holdSec >= 75 ? " (Mendekati Timeout)" : "";

    const stageBadge = pos.stage === 1 ? GREEN + " [TP1 HIT - 100% BEBAS RISIKO!]" + RESET : (pos.stage === 2 ? GREEN + " [TP2 HIT - KUNCI PROFIT +50%!]" + RESET : "");
    const slLabel = pos.stage >= 1 ? GREEN + "Breakeven " + pos.slPrice + RESET : RED + pos.slPrice + " (-12%)" + RESET;

    console.log("   " + BOLD + "[" + (i + 1) + "] " + CYAN + "[" + (pos.platform || "PUMP.FUN") + "] " + WHITE + displaySymbol + RESET + " " + DIM + "(Mint: " + pos.mint.substring(0, 8) + "...)" + RESET + stageBadge);
    console.log("       💵 Modal Beli   : " + pos.costSol + " SOL (Sisa: " + Math.round(pos.tokensRemaining).toLocaleString() + " token)");
    console.log("       📈 Harga Live   : " + currentPrice + " SOL");
    console.log("       🎯 Live PnL     : " + curPnlColor + BOLD + curPnlSign + pnlPercent + "%" + RESET);
    console.log("       🎯 Target       : TP1: " + GREEN + pos.tp1Price + " (+50%)" + RESET + " | TP2: " + GREEN + pos.tp2Price + " (+100%)" + RESET);
    console.log("       🛡️ Stop Loss    : " + slLabel);
    console.log("       ⏱️ Lama Hold    : " + holdColor + holdSec + " detik" + timeoutText + RESET);
    console.log("   " + DIM + "------------------------------------------------------------------" + RESET);
  }

  console.log("\n   " + DIM + "Tekan Ctrl+C untuk keluar dari dashboard live." + RESET + "\n");
  store.close();
}

void refreshDashboard();

setInterval(() => {
  void refreshDashboard();
}, 3000);

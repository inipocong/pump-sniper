// ANSI Color codes untuk tampilan terminal yang rapi dan berwarna
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const WHITE = "\x1b[37m";

function getTimestamp(): string {
  const now = new Date();
  return now.toTimeString().split(" ")[0]; // JJ:MM:DD
}

export const logger = {
  info(objOrMsg: any, maybeMsg?: string) {
    const time = `${DIM}[${getTimestamp()}]${RESET}`;

    if (typeof objOrMsg === "string") {
      console.log(`${time} ${CYAN}ℹ${RESET} ${objOrMsg}`);
      return;
    }

    const msg = maybeMsg || objOrMsg.msg || "";

    // ─── TAMPILAN PROGRESS POSISI LIVE (TRACKING HARGA REAL-TIME) ──────────
    if (msg.includes("[TRACKING]")) {
      const pnlNum = Number(objOrMsg.pnlPercent ?? 0);
      const pnlColor = pnlNum >= 0 ? GREEN : RED;
      const pnlSign = pnlNum >= 0 ? "+" : "";
      const plat = objOrMsg.platform ? `${MAGENTA}[${objOrMsg.platform}]${RESET} ` : "";

      console.log(
        `${time} ${CYAN}📈 [TRACKING]${RESET} ${plat}${BOLD}${WHITE}${objOrMsg.symbol || "TOKEN"}${RESET} ➔ Harga: ${objOrMsg.currentPrice} SOL | PnL: ${pnlColor}${BOLD}${pnlSign}${pnlNum}%${RESET} | TP: ${GREEN}${objOrMsg.tp1Price}${RESET} | SL: ${RED}${objOrMsg.slPrice}${RESET} | Hold: ${DIM}${objOrMsg.holdTimeSec}s${RESET}`
      );
      return;
    }

    // ─── TAMPILAN KARTU RAPI UNTUK PAPER BUY ───────────────────────────────
    if (msg.includes("[PAPER BUY]")) {
      const moonBadge = objOrMsg.isHighConviction || objOrMsg.costSol >= 0.03
        ? ` ${GREEN}${BOLD}🚀 [MOON CONVICTION - ALOKASI 0.03 SOL]${RESET}`
        : "";
      console.log(`\n${time} ${GREEN}${BOLD}🛒 >>> [SIMULASI BELI / PAPER BUY] <<<${RESET}${moonBadge}`);
      console.log(`   ├─ Platform : ${MAGENTA}${BOLD}${objOrMsg.platform || "PUMP.FUN"}${RESET}`);
      console.log(`   ├─ Token    : ${BOLD}${WHITE}${objOrMsg.symbol || "UNKNOWN"}${RESET}`);
      console.log(`   ├─ Mint     : ${DIM}${objOrMsg.mint}${RESET}`);
      const tierBadge = objOrMsg.convictionTier ? ` [${objOrMsg.convictionTier}]` : "";
      console.log(`   ├─ Beli     : ${GREEN}${BOLD}${objOrMsg.costSol} SOL${RESET} (${Number(objOrMsg.tokensBought).toLocaleString()} token)${tierBadge}`);
      console.log(`   ├─ Biaya Fee: ${YELLOW}${objOrMsg.buyFeeSol ?? 0.00095} SOL${RESET} (Platform 1% + Gas Priority)`);
      console.log(`   ├─ Harga Masuk: ${objOrMsg.entryPrice} SOL`);
      console.log(`   ├─ Target   : TP1: ${GREEN}${objOrMsg.tp1Target} (+50%)${RESET} | SL: ${RED}${objOrMsg.slTarget} (-15%)${RESET}`);
      console.log(`   ├─ Saldo Kas: ${CYAN}${BOLD}${objOrMsg.saldoKasStandby ?? objOrMsg.remainingBalance ?? 0} SOL Virtual${RESET}`);
      console.log(`   └─ Net PnL  : ${GREEN}${BOLD}${objOrMsg.totalNetPnl ?? "0.0000 SOL"}${RESET}\n`);
      return;
    }

    // ─── TAMPILAN TAKE PROFIT BERTAHAP ─────────────────────────────────────
    if (msg.includes("[PARTIAL TP1 HIT")) {
      console.log(`\n${time} ${GREEN}${BOLD}🎯 >>> [PARTIAL TAKE PROFIT 1 HIT (+50%)] <<<${RESET}`);
      console.log(`   ├─ Token      : ${BOLD}${WHITE}${objOrMsg.symbol}${RESET}`);
      console.log(`   ├─ Dijual     : ${GREEN}${BOLD}50% porsi${RESET} (${Number(objOrMsg.tokensSold).toLocaleString()} token)`);
      console.log(`   ├─ Kas Balik  : ${GREEN}${BOLD}+${objOrMsg.cashReturnedSol} SOL${RESET} (Modal Pokok Aman!)`);
      console.log(`   ├─ Sisa Token : ${WHITE}${Number(objOrMsg.tokensRemaining).toLocaleString()} token${RESET} ("Moonbag")`);
      console.log(`   ├─ 🛡️ SL BARU : ${CYAN}${BOLD}${objOrMsg.newSlPrice} SOL${RESET} (Breakeven - 100% BEBAS RISIKO!)`);
      console.log(`   └─ Saldo Kas  : ${CYAN}${BOLD}${objOrMsg.newBalance} SOL Virtual${RESET}\n`);
      return;
    }

    if (msg.includes("[PARTIAL TP2 HIT")) {
      console.log(`\n${time} ${GREEN}${BOLD}🚀 >>> [PARTIAL TAKE PROFIT 2 HIT (+100% / 2X)] <<<${RESET}`);
      console.log(`   ├─ Token      : ${BOLD}${WHITE}${objOrMsg.symbol}${RESET}`);
      console.log(`   ├─ Dijual     : ${GREEN}${BOLD}25% porsi${RESET} (${Number(objOrMsg.tokensSold).toLocaleString()} token)`);
      console.log(`   ├─ Kas Balik  : ${GREEN}${BOLD}+${objOrMsg.cashReturnedSol} SOL${RESET}`);
      console.log(`   ├─ 🛡️ SL BARU : ${CYAN}${BOLD}${objOrMsg.newSlPrice} SOL${RESET} (Mengunci Profit +50%!)`);
      console.log(`   └─ Saldo Kas  : ${CYAN}${BOLD}${objOrMsg.newBalance} SOL Virtual${RESET}\n`);
      return;
    }

    if (msg.includes("[FINAL TP3 HIT")) {
      console.log(`\n${time} ${GREEN}${BOLD}🌕 >>> [FINAL TAKE PROFIT 3 HIT (+200% / 3X)] <<<${RESET}`);
      console.log(`   ├─ Token      : ${BOLD}${WHITE}${objOrMsg.symbol}${RESET}`);
      console.log(`   ├─ Net Cuan   : ${GREEN}${BOLD}+${objOrMsg.pnlSol} SOL (${objOrMsg.pnlPercent})${RESET}`);
      console.log(`   ├─ Keterangan : ${BOLD}${GREEN}FULL EXIT - Pesta cuan 300% selesai!${RESET}`);
      console.log(`   └─ Saldo Baru : ${CYAN}${BOLD}${objOrMsg.newBalance} SOL Virtual${RESET}\n`);
      return;
    }

    if (msg.includes("[BREAKEVEN SL HIT]")) {
      console.log(`\n${time} ${CYAN}${BOLD}🛡️ >>> [BREAKEVEN STOP LOSS HIT] <<<${RESET}`);
      console.log(`   ├─ Token      : ${BOLD}${WHITE}${objOrMsg.symbol}${RESET}`);
      console.log(`   ├─ Keterangan : Sisa posisi keluar di harga modal (Breakeven).`);
      console.log(`   ├─ Hasil Akhir: ${GREEN}${BOLD}TETAP CUAN +${objOrMsg.pnlSol} SOL (${objOrMsg.pnlPercent})${RESET}`);
      console.log(`   └─ Saldo Baru : ${CYAN}${BOLD}${objOrMsg.newBalance} SOL Virtual${RESET}\n`);
      return;
    }

    // ─── TAMPILAN KEPUTUSAN SKIP & SLOT PENUH ──────────────────────────────
    if (msg.includes("[SLOT PENUH 3/3]")) {
      const plat = objOrMsg.platform ? `${MAGENTA}[${objOrMsg.platform}]${RESET} ` : "";
      console.log(
        `${time} ${YELLOW}⏸️ [SLOT PENUH 3/3]${RESET} ${plat}${BOLD}${objOrMsg.symbol || "TOKEN"}${RESET} ${DIM}(Skor: ${objOrMsg.confidenceScore ?? "?"}) lolos filter, tapi 3 slot posisi sedang penuh.${RESET}`
      );
      return;
    }

    if (msg.includes("[SNIPER: SKIP]")) {
      const plat = objOrMsg.platform ? `${MAGENTA}[${objOrMsg.platform}]${RESET} ` : "";
      console.log(
        `${time} ${YELLOW}⚡ [SKIP]${RESET} ${plat}${BOLD}${objOrMsg.symbol || "TOKEN"}${RESET} ${DIM}(Skor: ${objOrMsg.confidenceScore ?? "?"})${RESET} ➔ ${DIM}${objOrMsg.abortReasons?.join("; ") || msg}${RESET}`
      );
      return;
    }

    console.log(`${time} ${CYAN}ℹ${RESET} ${msg}`);
  },

  warn(objOrMsg: any, maybeMsg?: string) {
    const time = `${DIM}[${getTimestamp()}]${RESET}`;
    const msg = typeof objOrMsg === "string" ? objOrMsg : maybeMsg || objOrMsg.msg || "";

    // ─── TAMPILAN TIMEOUT / STAGNANT AUTO-CUT ─────────────────────────────
    if (msg.includes("[PAPER STAGNANT EXIT]")) {
      console.log(`\n${time} ${YELLOW}${BOLD}⏱️ >>> [TIMEOUT / STAGNANT AUTO-CUT] <<<${RESET}`);
      console.log(`   ├─ Token    : ${BOLD}${WHITE}${objOrMsg.symbol}${RESET}`);
      console.log(`   ├─ Keterangan: ${DIM}Koin tidak bergerak (>35 detik) - auto exit${RESET}`);
      console.log(`   ├─ Net PnL  : ${objOrMsg.pnlSol >= 0 ? GREEN : RED}${BOLD}${objOrMsg.pnlSol >= 0 ? "+" : ""}${objOrMsg.pnlSol} SOL (${objOrMsg.pnlPercent})${RESET}`);
      console.log(`   ├─ Total Fee: ${YELLOW}${objOrMsg.feeSol ?? "0.0019"} SOL${RESET} (Platform 1% + Gas Priority)`);
      console.log(`   └─ Saldo Baru: ${CYAN}${BOLD}${objOrMsg.newBalance} SOL Virtual${RESET}\n`);
      return;
    }

    // ─── TAMPILAN STOP LOSS ────────────────────────────────────────────────
    if (msg.includes("[PAPER SL HIT]")) {
      console.log(`\n${time} ${RED}${BOLD}🛑 >>> [STOP LOSS HIT / CUT LOSS] <<<${RESET}`);
      console.log(`   ├─ Token    : ${BOLD}${WHITE}${objOrMsg.symbol}${RESET}`);
      console.log(`   ├─ Harga Jual: ${objOrMsg.exitPrice} SOL`);
      console.log(`   ├─ Net Loss : ${RED}${BOLD}${objOrMsg.pnlSol} SOL (${objOrMsg.pnlPercent})${RESET}`);
      console.log(`   ├─ Total Fee: ${YELLOW}${objOrMsg.feeSol ?? "0.0019"} SOL${RESET} (Platform 1% + Gas Priority)`);
      console.log(`   └─ Saldo Baru: ${CYAN}${BOLD}${objOrMsg.newBalance} SOL Virtual${RESET}\n`);
      return;
    }

    // ─── TAMPILAN REJECT SCAM / HONEYPOT ───────────────────────────────────
    if (msg.includes("[RISK: REJECT]")) {
      console.log(`${time} ${RED}🛡️ [REJECT]${RESET} ${BOLD}${objOrMsg.symbol || "TOKEN"}${RESET} ➔ ${DIM}Terdeteksi Scam/Honeypot${RESET}`);
      return;
    }

    console.log(`${time} ${YELLOW}⚠️  ${msg}${RESET}`);
  },

  error(objOrMsg: any, maybeMsg?: string) {
    const time = `${DIM}[${getTimestamp()}]${RESET}`;
    const detail = objOrMsg?.error?.message || objOrMsg?.error || (typeof objOrMsg === "object" && objOrMsg?.msg ? "" : "");
    const baseMsg = typeof objOrMsg === "string" ? objOrMsg : maybeMsg || objOrMsg?.msg || "";
    const fullMsg = detail ? `${baseMsg} (${detail})` : baseMsg;
    console.log(`${time} ${RED}❌ ${fullMsg}${RESET}`);
  },

  fatal(objOrMsg: any, maybeMsg?: string) {
    const time = `${DIM}[${getTimestamp()}]${RESET}`;
    const msg = typeof objOrMsg === "string" ? objOrMsg : maybeMsg || objOrMsg.msg || "";
    console.log(`${time} ${RED}${BOLD}💀 [FATAL] ${msg}${RESET}`);
  },
};

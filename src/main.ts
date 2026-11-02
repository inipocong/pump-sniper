import { config } from "./config.js";
import { Store } from "./db.js";
import { logger } from "./logger.js";
import { SolanaLogsFeed } from "./feeds/solanaLogs.js";
import { PaperTrader } from "./paper/paperTrader.js";

async function main() {
  const mode = process.argv.find(a => a.startsWith("--mode="))?.split("=")[1] ?? config.mode;
  if (mode !== "monitor" && mode !== "demo") {
    throw new Error("This milestone only supports monitor/demo. Live trading is disabled.");
  }

  const store = new Store();
  await store.init();

  // Inisialisasi Dompet Virtual Paper Trading (Modal default: 10 SOL virtual)
  const paperTrader = new PaperTrader(store, { initialVirtualBalanceSol: 10.0 });

  logger.info(
    {
      mode,
      programId: config.pumpProgramId,
      virtualBalanceSol: paperTrader.getVirtualBalance(),
      tradingMode: "PAPER_TRADING_SIMULATION (Zero Risk, No Private Key)",
    },
    "🚀 Pump Sniper Bot dimulai dengan Sistem Proteksi Lengkap & Paper Trading"
  );

  if (mode === "demo") {
    logger.info("Demo mode selesai.");
    store.close();
    return;
  }

  const feed = new SolanaLogsFeed(store, paperTrader);
  feed.start();

  const shutdown = () => {
    logger.info("Menghentikan bot...");
    feed.stop();
    store.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(error => {
  logger.fatal({ error }, "Fatal error");
  process.exit(1);
});
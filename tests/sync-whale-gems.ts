import { Store } from "../src/db.js";
import { SolanaRpcClient } from "../src/risk/solanaRpc.js";
import { resolveTokenPriceAndMetadata } from "../src/risk/tokenPriceResolver.js";

async function syncWhaleGems() {
  const store = new Store();
  await store.init();
  const rpc = new SolanaRpcClient();

  const openTrades = store.getOpenPaperTrades();
  console.log(`Menemukan ${openTrades.length} trade terbuka di database.`);

  for (const trade of openTrades) {
    console.log(`\nMemeriksa ${trade.mint} (Symbol saat ini: ${trade.symbol})...`);
    const info = await resolveTokenPriceAndMetadata(rpc, trade.mint, null);
    console.log(`Hasil resolusi: Symbol=${info.symbol}, Name=${info.name}, Price=${info.priceInSol} SOL (Source: ${info.source})`);

    if (info.symbol && info.symbol !== "WHALE_GEM") {
      trade.symbol = info.symbol;
      store.savePaperTrade(trade);
      console.log(`✅ Berhasil memperbarui simbol menjadi ${trade.symbol}!`);
    }
  }

  store.close();
  console.log("\nSelesai sinkronisasi.");
}

void syncWhaleGems();

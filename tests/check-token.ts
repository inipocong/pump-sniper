import { Store } from "../src/db.js";

async function main() {
  const store = new Store();
  await store.init();

  const cands = (store as any).db.exec("SELECT signature, mint, symbol, name, detected_at FROM candidates WHERE symbol LIKE '%SC%' OR name LIKE '%Cat%' OR symbol LIKE '%SKIVE%' OR symbol LIKE '%NARRATIVE%' OR symbol LIKE '%LMC%'");
  console.log("=== HASIL PENCARIAN KOIN SCREENSHOT DI DATABASE BOT ===");
  if (cands.length > 0) {
    const cols = cands[0].columns;
    cands[0].values.forEach((row: any[]) => {
      console.log(`[${row[cols.indexOf("symbol")]}] ${row[cols.indexOf("name")]} | Mint: ${row[cols.indexOf("mint")]}`);
    });
  } else {
    console.log("Tidak ada yang cocok dengan filter query");
  }

  const allCount = (store as any).db.exec("SELECT count(*) as cnt FROM candidates");
  console.log("Total koin tercatat di DB:", allCount[0].values[0][0]);
}

void main();

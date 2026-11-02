import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";

async function resetPaperTrades() {
  const dbPath = config.dbPath;

  console.log(`\n🧹 Sedang membersihkan data paper trading...`);

  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
      console.log(`✅ Berhasil mereset database SQLite (${dbPath})!`);
      console.log(`✨ Semua posisi lama yang tersangkut dan riwayat trade telah dibersihkan.`);
      console.log(`🚀 Saldo virtual kembali segar 10.0 SOL siap berburu koin aktif baru!\n`);
    } catch (err) {
      console.error(`❌ Gagal menghapus database:`, err);
    }
  } else {
    console.log(`ℹ️ Database belum dibuat atau sudah bersih.`);
  }
}

resetPaperTrades();

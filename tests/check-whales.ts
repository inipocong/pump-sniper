import { SolanaRpcClient } from "../src/risk/solanaRpc.js";
import { config } from "../src/config.js";

async function checkRecentActivity() {
  const rpc = new SolanaRpcClient();
  const w1 = "DQMqCjCiRS8BAkZ2xrJ7QJPqUjoHnRDoPtcXMiEPtSus";
  const w2 = "4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9";

  console.log("=== MEMERIKSA TRANSAKSI TERAKHIR WALLET 1 (DQMq...) ===");
  const sigs1 = await rpc.getSignaturesForAddress(w1, 5);
  for (const s of sigs1) {
    const time = s.blockTime ? new Date(s.blockTime * 1000).toLocaleTimeString() : "N/A";
    console.log(`Sig: ${s.signature} | Time: ${time}`);
  }

  console.log("\n=== MEMERIKSA TRANSAKSI TERAKHIR WALLET 2 (4vw54...) ===");
  const sigs2 = await rpc.getSignaturesForAddress(w2, 5);
  for (const s of sigs2) {
    const time = s.blockTime ? new Date(s.blockTime * 1000).toLocaleTimeString() : "N/A";
    console.log(`Sig: ${s.signature} | Time: ${time}`);
  }
}

void checkRecentActivity();

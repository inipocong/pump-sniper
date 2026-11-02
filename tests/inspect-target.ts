import { SolanaRpcClient } from "../src/risk/solanaRpc.js";

async function inspectTargetWallet() {
  const TARGET_WALLET = "DQMqCjCiRS8BAkZ2xrJ7QJPqUjoHnRDoPtcXMiEPtSus";
  const rpc = new SolanaRpcClient();

  console.log(`🔍 Memeriksa transaksi terkini dari Target Wallet: ${TARGET_WALLET}...`);

  const sigs = await rpc.getSignaturesForAddress(TARGET_WALLET, 10);
  console.log(`Ditemukan ${sigs.length} transaksi terakhir:`);
  sigs.forEach((s, idx) => {
    const time = s.blockTime ? new Date(s.blockTime * 1000).toLocaleTimeString() : "N/A";
    console.log(`[${idx + 1}] Sig: ${s.signature.substring(0, 20)}... | Slot: ${s.slot} | Time: ${time}`);
  });
}

void inspectTargetWallet();

import { SolanaRpcClient } from "../src/risk/solanaRpc.js";
import { config } from "../src/config.js";

async function inspectWallet() {
  const TARGET_WALLET = "DQMqCjCiRS8BAkZ2xrJ7QJPqUjoHnRDoPtcXMiEPtSus";
  const rpc = new SolanaRpcClient();
  const sigs = await rpc.getSignaturesForAddress(TARGET_WALLET, 15);

  console.log(`Checking 15 txs for ${TARGET_WALLET}:`);
  for (const s of sigs) {
    const res = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [s.signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]
      })
    });
    const data = await res.json() as any;
    const logs = data.result?.meta?.logMessages ?? [];
    const instructions = logs.filter((l: string) => l.includes("Instruction:"));
    console.log(`Sig: ${s.signature.substring(0, 12)}... | Instructions:`, instructions);
  }
}

void inspectWallet();

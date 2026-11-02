import { SolanaRpcClient } from "../src/risk/solanaRpc.js";
import { config } from "../src/config.js";

async function inspectW2() {
  const w2 = "4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9";
  const rpc = new SolanaRpcClient();
  const sigs = await rpc.getSignaturesForAddress(w2, 5);

  console.log(`Found ${sigs.length} sigs for W2:`);
  for (const s of sigs) {
    const res = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [s.signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]
      })
    });
    const data = await res.json() as any;
    console.log(`Sig: ${s.signature.substring(0, 15)}... | Err:`, data.error, `| Result:`, Boolean(data.result));
    if (data.result) {
      const logs: string[] = data.result.meta?.logMessages ?? [];
      console.log("   Instructions:", logs.filter((l: string) => l.includes("Instruction:") || l.includes("Program 6EF")));
      const preList = data.result.meta?.preTokenBalances?.filter((b: any) => b.owner === w2);
      const postList = data.result.meta?.postTokenBalances?.filter((b: any) => b.owner === w2);
      console.log("   Token balance changes for W2:", { preList, postList });
    }
  }
}

void inspectW2();

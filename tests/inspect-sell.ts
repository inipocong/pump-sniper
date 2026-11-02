import { SolanaRpcClient } from "../src/risk/solanaRpc.js";
import { config } from "../src/config.js";

async function inspectSell() {
  const TARGET_WALLET = "DQMqCjCiRS8BAkZ2xrJ7QJPqUjoHnRDoPtcXMiEPtSus";
  const rpc = new SolanaRpcClient();
  const sigs = await rpc.getSignaturesForAddress(TARGET_WALLET, 1);
  const fullSig = sigs[0].signature;

  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [fullSig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]
    })
  });
  const data = await res.json() as any;
  console.log("Sig:", fullSig);
  console.log("PreBalances:", data.result?.meta?.preTokenBalances?.filter((b: any) => b.owner === TARGET_WALLET));
  console.log("PostBalances:", data.result?.meta?.postTokenBalances?.filter((b: any) => b.owner === TARGET_WALLET));
}

void inspectSell();

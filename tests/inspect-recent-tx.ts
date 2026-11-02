import { config } from "../src/config.js";

async function inspectWhaleTx() {
  const sig1 = "2XAT87RyxyLwoEB7Azc3haBaTtHQ9rKwXjhhRRYrZN4aaTMfNJnmz9HZHiox3iPJPRtqLNWcCRkgiKLm4cNTbNbQ";
  const sig2 = "3apPXrLCuWxSJKKERWhoruPeSCUZTLUcZbBTnMUTQW4EbBix7GEozegNV1kcfRfT8VtASjGspkSJDY3rAC2S7JAx";

  for (const [name, sig] of [["W1", sig1], ["W2", sig2]]) {
    console.log(`\n=== DETAIL TRANSAKSI ${name}: ${sig} ===`);
    const res = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [sig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]
      })
    });
    const data = await res.json() as any;
    console.log("Logs:", data.result?.meta?.logMessages);
    console.log("AccountKeys:", data.result?.transaction?.message?.accountKeys?.map((k: any) => typeof k === 'string' ? k : k.pubkey));
    console.log("PreTokenBalances:", data.result?.meta?.preTokenBalances);
    console.log("PostTokenBalances:", data.result?.meta?.postTokenBalances);
  }
}

void inspectWhaleTx();

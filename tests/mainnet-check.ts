
import {
  decodeCreateV2Transaction,
  type RpcTransaction
} from "../src/decoder/pumpCreateV2.js";

const signature =
  "352rKJpYcBVv5wL4Anf5YBftwVhuncpdDFN2eUP1dm4xj6uSKjW6iikAW4zpzHAb42ULYWwhhWqzcF4Tk516tHqf";

const programId = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

async function main() {
  const response = await fetch(
    "https://api.mainnet-beta.solana.com",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          signature,
          {
            encoding: "json",
            commitment: "confirmed",
            maxSupportedTransactionVersion: 1
          }
        ]
      })
    }
  );

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const payload = await response.json() as {
    result?: RpcTransaction | null;
    error?: unknown;
  };

  if (payload.error || !payload.result) {
    throw new Error(
      `Transaction unavailable: ${JSON.stringify(payload.error)}`
    );
  }

  const decoded = decodeCreateV2Transaction(
    payload.result,
    signature,
    programId
  );

  console.log("MAINNET TRANSACTION:", signature);
  console.log("DECODE RESULT:", decoded);
}

main().catch(console.error);

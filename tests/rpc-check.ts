
import { SolanaRpcClient } from "../src/risk/solanaRpc.js";

async function main() {
  const rpc = new SolanaRpcClient();

  console.log("Checking Solana RPC...");

  const health = await rpc.getHealth();
  console.log("RPC HEALTH:", health);

  const slot = await rpc.getSlot();
  console.log("CURRENT SLOT:", slot);

  if (health !== "ok" || slot <= 0) {
    throw new Error("RPC verification failed");
  }

  console.log("RPC CONNECTION: PASS");
}

main().catch(error => {
  console.error("RPC CHECK FAILED:", error.message);
  process.exitCode = 1;
});

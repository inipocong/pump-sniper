import "dotenv/config";
const mode = process.env.BOT_MODE ?? "monitor";
if (!["monitor", "demo"].includes(mode)) {
  throw new Error("This milestone supports monitor/demo only. Trading modes remain disabled.");
}
export const config = {
  mode,
  wsUrl: process.env.SOLANA_WS_URL ?? "",
  rpcUrl: process.env.SOLANA_RPC_URL ?? "",
  pumpProgramId: process.env.PUMP_PROGRAM_ID ?? "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  moonshotProgramId: process.env.MOONSHOT_PROGRAM_ID ?? "MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG",
  raydiumCpmmProgramId: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  meteoraDlmmProgramId: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  dbPath: process.env.DB_PATH ?? "./data/sniper.sqlite",
  logLevel: process.env.LOG_LEVEL ?? "info",
};

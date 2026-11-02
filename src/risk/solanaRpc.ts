import { config } from "../config.js";

interface RpcError {
  code: number;
  message: string;
}

interface RpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: RpcError;
}

export interface SolanaAccountInfo {
  owner: string;
  executable: boolean;
  lamports: number;
  data: [string, string];
  rentEpoch: number;
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
  memo: string | null;
  blockTime: number | null;
}

export interface TokenLargestAccount {
  address: string;
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString: string;
}

export class SolanaRpcClient {
  private endpoint: string;
  private requestId = 0;

  constructor(endpoint = config.rpcUrl) {
    if (!endpoint) {
      throw new Error("SOLANA_RPC_URL is missing");
    }

    const url = new URL(endpoint);

    if (url.protocol !== "https:") {
      throw new Error("RPC must use HTTPS");
    }

    this.endpoint = endpoint;
  }

  private async request<T>(
    method: string,
    params: unknown[] = []
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      3500
    );

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.requestId,
          method,
          params
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`RPC HTTP ${response.status}`);
      }

      const payload =
        await response.json() as RpcResponse<T>;

      if (payload.error) {
        throw new Error(
          `RPC ${payload.error.code}: ${payload.error.message}`
        );
      }

      if (payload.result === undefined) {
        throw new Error("RPC returned no result");
      }

      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getSlot(): Promise<number> {
    return this.request<number>("getSlot", [
      { commitment: "confirmed" }
    ]);
  }

  async getHealth(): Promise<string> {
    return this.request<string>("getHealth");
  }

  async getAccountInfo(
    address: string
  ): Promise<SolanaAccountInfo | null> {
    const result = await this.request<{
      value: SolanaAccountInfo | null;
    }>("getAccountInfo", [
      address,
      {
        encoding: "base64",
        commitment: "confirmed"
      }
    ]);

    return result.value;
  }

  async getBalance(address: string): Promise<number> {
    const result = await this.request<{ value: number }>("getBalance", [
      address,
      { commitment: "confirmed" }
    ]);

    return result.value;
  }

  async getSignaturesForAddress(
    address: string,
    limit = 20
  ): Promise<SignatureInfo[]> {
    return this.request<SignatureInfo[]>("getSignaturesForAddress", [
      address,
      { limit, commitment: "confirmed" }
    ]);
  }

  async getTokenLargestAccounts(
    mint: string
  ): Promise<TokenLargestAccount[]> {
    const result = await this.request<{
      value: TokenLargestAccount[];
    }>("getTokenLargestAccounts", [
      mint,
      { commitment: "confirmed" }
    ]);

    return result.value ?? [];
  }
}
# Pump Sniper Step 1: create_v2 event decoder

This milestone adds a read-only decoder for Pump.fun `create_v2` transactions.
No wallet, signing, buy/sell executor, or live trading code is included.

## Install
```bash
npm install
cp .env.example .env
npm run typecheck
npm run monitor
```
Windows CMD: use `copy .env.example .env`. Termux: use `cp`.

Set `SOLANA_WS_URL` and `SOLANA_RPC_URL` to your RPC provider endpoints. The default
Pump program ID is copied from Pump's official public docs. Use a provider that supports
`logsSubscribe` and `getTransaction`.

## What it decodes
- Watches confirmed logs for `Instruction: CreateV2`.
- Fetches the confirmed transaction from RPC.
- Locates the Pump program instruction by program ID and Anchor discriminator.
- Resolves static + address lookup table account keys.
- Decodes Borsh `name`, `symbol`, `uri`, and `creator`.
- Extracts mint (account 1) and bonding curve (account 3) from the documented
  `create_v2` account order.
- Stores the decoded candidate in SQLite.

## Important limitations
- `create_v2` only. Legacy `create` is deliberately not decoded.
- No token safety verdict yet. Decoding a token does not mean it is safe.
- If the RPC transaction is unavailable at confirmed commitment, it is skipped.
  A production queue should retry with bounded backoff and deduplication.
- Inner instructions are scanned, but the account-index mapping for compiled
  instructions is resolved against transaction keys. Test this on real fixtures.
- This is read-only. Trading remains disabled.

Official references:
- https://github.com/pump-fun/pump-public-docs
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md

# Decoder validation checklist

Before trusting this decoder:

1. Capture confirmed `create_v2` transactions from Solana mainnet.
2. Compare decoded mint (account index 0), bonding curve (account index 2), and creator argument against a trusted explorer and Pump's official docs.
3. Include transactions with address lookup tables and inner instructions.
4. Verify failed transactions are ignored.
5. Verify legacy `create` and unrelated Pump instructions are ignored, not misclassified.
6. Verify malformed base58/Borsh data throws or returns no candidate.
7. Re-test whenever Pump publishes an IDL/account-layout update.

The decoder intentionally handles `create_v2` only. It does not claim support for older `create` transactions or every future variant.

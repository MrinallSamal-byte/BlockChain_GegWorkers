# Amoy Deployment Notes

After running `pnpm deploy:amoy`, fill in `amoy.json` with the addresses printed by the deploy script.

Set `deployedAt` to the ISO 8601 UTC timestamp of the deployment block, e.g. `2026-01-15T10:30:00Z`.

Each contract entry needs the deployed `address`, the deploy transaction hash (`txHash`), and the `blockNumber` at which it was mined.

The `configuration` block records the post-deploy `cast` calls that wire the contracts together (see `deployments/README.md`).

Verify on Amoy Polygonscan: https://amoy.polygonscan.com/address/<address>#code

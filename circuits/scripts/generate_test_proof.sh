#!/usr/bin/env bash
set -euo pipefail

CIRCUIT=location_within_radius
BUILD_DIR="$(dirname "$0")/../build"
INPUT_DIR="$(dirname "$0")/../input"

echo "==> Generating witness"
node "$BUILD_DIR/${CIRCUIT}_js/generate_witness.js" \
  "$BUILD_DIR/${CIRCUIT}_js/$CIRCUIT.wasm" \
  "$INPUT_DIR/sample_valid_input.json" \
  "$BUILD_DIR/witness.wtns"

echo "==> Generating proof"
snarkjs groth16 prove \
  "$BUILD_DIR/${CIRCUIT}_final.zkey" \
  "$BUILD_DIR/witness.wtns" \
  "$BUILD_DIR/proof.json" \
  "$BUILD_DIR/public.json"

echo "==> Verifying proof"
snarkjs groth16 verify \
  "$BUILD_DIR/verification_key.json" \
  "$BUILD_DIR/public.json" \
  "$BUILD_DIR/proof.json"

echo "==> Exporting Solidity calldata"
snarkjs groth16 exportsoliditycalldata \
  "$BUILD_DIR/public.json" \
  "$BUILD_DIR/proof.json"

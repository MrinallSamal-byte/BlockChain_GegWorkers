#!/usr/bin/env bash
set -euo pipefail

CIRCUIT=location_within_radius
CIRCUITS_DIR="$(dirname "$0")/../circuits"
BUILD_DIR="$(dirname "$0")/../build"

mkdir -p "$BUILD_DIR"

echo "==> Compiling $CIRCUIT.circom"
circom "$CIRCUITS_DIR/$CIRCUIT.circom" \
  --r1cs --wasm --sym \
  --output "$BUILD_DIR" \
  --include node_modules

echo "==> Compilation complete"
echo "    r1cs : $BUILD_DIR/$CIRCUIT.r1cs"
echo "    wasm : $BUILD_DIR/${CIRCUIT}_js/$CIRCUIT.wasm"
echo "    sym  : $BUILD_DIR/$CIRCUIT.sym"

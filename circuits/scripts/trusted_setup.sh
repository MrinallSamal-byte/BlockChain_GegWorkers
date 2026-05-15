#!/usr/bin/env bash
# Groth16 trusted setup for location_within_radius circuit.
# Uses a Powers of Tau ceremony file. For production, use a multi-party ceremony.
set -euo pipefail

CIRCUIT=location_within_radius
BUILD_DIR="$(dirname "$0")/../build"
PTAU_FILE="powersOfTau28_hez_final_16.ptau"
PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/$PTAU_FILE"

mkdir -p "$BUILD_DIR"

if [ ! -f "$BUILD_DIR/$PTAU_FILE" ]; then
  echo "==> Downloading Powers of Tau"
  curl -L "$PTAU_URL" -o "$BUILD_DIR/$PTAU_FILE"
fi

echo "==> Phase 2 setup"
snarkjs groth16 setup \
  "$BUILD_DIR/$CIRCUIT.r1cs" \
  "$BUILD_DIR/$PTAU_FILE" \
  "$BUILD_DIR/${CIRCUIT}_0000.zkey"

echo "==> Contribute to ceremony (dev only — replace with real contribution in production)"
snarkjs zkey contribute \
  "$BUILD_DIR/${CIRCUIT}_0000.zkey" \
  "$BUILD_DIR/${CIRCUIT}_final.zkey" \
  --name="VGDP Dev Contribution" -v

echo "==> Export verification key"
snarkjs zkey export verificationkey \
  "$BUILD_DIR/${CIRCUIT}_final.zkey" \
  "$BUILD_DIR/verification_key.json"

echo "==> Export Solidity verifier"
snarkjs zkey export solidityverifier \
  "$BUILD_DIR/${CIRCUIT}_final.zkey" \
  "$BUILD_DIR/LocationVerifier.sol"

echo "==> Trusted setup complete"

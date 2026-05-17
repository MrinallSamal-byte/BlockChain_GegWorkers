# ZK Circuit — Design Notes

## Circuit: `location_within_radius.circom`

**Proving system:** Groth16 (constant-size proof, constant-time verification)
**Library:** Circom 2.1.6 + circomlib 2.x
**Constraint count (approx):** ~500 R1CS constraints

---

## Coordinate encoding

All coordinates are passed as integers to avoid floating-point issues:

| Signal | Formula | Example (Bhubaneswar) |
|--------|---------|----------------------|
| `targetLatShiftedE7` | `lat * 1e7 + 900_000_000` | `129_716_000 + 900_000_000 = 1_029_716_000` |
| `targetLonShiftedE7` | `lon * 1e7 + 1_800_000_000` | `775_947_000 + 1_800_000_000 = 2_575_947_000` |

The shift makes all values non-negative, fitting in 32-bit unsigned integers.

---

## Distance calculation

VGDP v1 uses the **local tangent plane (equirectangular) approximation**:

```
dy_metres = dLat_E7 * 111_320 / 10_000_000
dx_metres = dLon_E7 * 111_320 * cos(targetLat) / 10_000_000
dist²     = dy² + dx²
```

The `cos(targetLat)` factor is precomputed off-chain by the prover and passed as the private witness `metersPerLonE7Q`.

**Accuracy:** < 0.1% error for radii ≤ 1000 m at any latitude. Acceptable for delivery radius enforcement.

**Future:** Haversine-based circuit using Taylor series expansion of `sin`/`cos` for global accuracy.

---

## Public signals (6 total)

| Index | Name | Description |
|-------|------|-------------|
| 0 | `targetLatShiftedE7` | Delivery target latitude (shifted) |
| 1 | `targetLonShiftedE7` | Delivery target longitude (shifted) |
| 2 | `maxRadiusMeters` | Acceptance radius (1–1000) |
| 3 | `orderIdField` | `uint256(orderIdHash) % SNARK_SCALAR_FIELD` |
| 4 | `riderDidField` | `uint256(riderDidHash) % SNARK_SCALAR_FIELD` |
| 5 | `timestampField` | `uint256(timestampHash) % SNARK_SCALAR_FIELD` |

Signals 3–5 bind the proof to a specific order, rider, and timestamp. Without them, a valid proof for one delivery could be replayed for another.

---

## Private inputs (3)

| Signal | Description |
|--------|-------------|
| `actualLatShiftedE7` | Rider's actual GPS latitude (private) |
| `actualLonShiftedE7` | Rider's actual GPS longitude (private) |
| `metersPerLonE7Q` | Precomputed longitude scale at target latitude |

These never appear in the proof or public signals.

---

## Trusted setup

For production, the Phase 2 ceremony must involve ≥ 3 independent parties who each contribute randomness and publicly post their contribution transcript. The dev `trusted_setup.sh` script uses a single contribution and is **not suitable for production**.

Powers of Tau used: `powersOfTau28_hez_final_16.ptau` (2^16 constraints max, well above our ~500).

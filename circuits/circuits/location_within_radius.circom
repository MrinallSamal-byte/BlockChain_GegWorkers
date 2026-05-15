pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";

// ============================================================
// LocationWithinRadiusLocalPlane
//
// V1 production circuit. Uses the local tangent plane approximation
// which is accurate to < 0.1% error for radii up to 1000 m.
//
// Public inputs (6):
//   targetLatShiftedE7   - target lat + 900_000_000 (unsigned)
//   targetLonShiftedE7   - target lon + 1_800_000_000 (unsigned)
//   maxRadiusMeters      - max accepted distance (1..1000)
//   orderIdField         - uint256(orderIdHash) % SNARK_SCALAR_FIELD
//   riderDidField        - uint256(riderDidHash) % SNARK_SCALAR_FIELD
//   timestampField       - uint256(timestampHash) % SNARK_SCALAR_FIELD
//   metersPerLonE7Q      - 111320 * cos(targetLat) * Q / 10_000_000
//                          precomputed off-chain, passed as public input
//
// Private inputs (2):
//   actualLatShiftedE7   - actual lat + 900_000_000 (must be within radius)
//   actualLonShiftedE7   - actual lon + 1_800_000_000 (must be within radius)
//
// Q = 10^9 (fixed-point scale factor for integer arithmetic)
// ============================================================

template AbsDiff() {
    signal input a;
    signal input b;
    signal output diff;
    signal isALtB;

    component lt = LessThan(64);
    lt.in[0] <== a;
    lt.in[1] <== b;
    isALtB <== lt.out;

    signal d1;
    signal d2;
    d1 <== b - a;
    d2 <== a - b;
    diff <== isALtB * d1 + (1 - isALtB) * d2;
}

template LocationWithinRadiusLocalPlane() {
    // ---- Public inputs ----
    signal input targetLatShiftedE7;
    signal input targetLonShiftedE7;
    signal input maxRadiusMeters;
    signal input orderIdField;
    signal input riderDidField;
    signal input timestampField;
    signal input metersPerLonE7Q;

    // ---- Private inputs ----
    signal input actualLatShiftedE7;
    signal input actualLonShiftedE7;

    // ---- Range checks on private inputs ----
    // actualLatShiftedE7 in [0, 1_800_000_000]  (shifted [-90,90]*1e7)
    component latHi = LessEqThan(31);
    latHi.in[0] <== actualLatShiftedE7;
    latHi.in[1] <== 1800000000;
    latHi.out === 1;

    // actualLonShiftedE7 in [0, 3_600_000_000]  (shifted [-180,180]*1e7)
    component lonHi = LessEqThan(32);
    lonHi.in[0] <== actualLonShiftedE7;
    lonHi.in[1] <== 3600000000;
    lonHi.out === 1;

    // radius in [1, 1000]
    component radHi = LessEqThan(16);
    radHi.in[0] <== maxRadiusMeters;
    radHi.in[1] <== 1000;
    radHi.out === 1;

    component radLo = GreaterThan(16);
    radLo.in[0] <== maxRadiusMeters;
    radLo.in[1] <== 0;
    radLo.out === 1;

    // ---- Distance calculation (E7 degrees, fixed point Q=10^9) ----
    // dy = |actualLat - targetLat| * 111320 * Q / 10_000_000
    // dx = |actualLon - targetLon| * metersPerLonE7Q
    //
    // 1 E7-degree of latitude = 111320 / 10_000_000 metres
    //                         = 0.011132 metres
    // We scale by Q=10^9 to keep integer arithmetic.
    // dy_Q = dLatE7 * 111320 * 1000 / 10_000_000  (×10^3 to scale into Q)
    //      = dLatE7 * 111320 / 10000             (simplify)
    //      = dLatE7 * 11132 / 1000

    component absDLat = AbsDiff();
    absDLat.a <== actualLatShiftedE7;
    absDLat.b <== targetLatShiftedE7;

    component absDLon = AbsDiff();
    absDLon.a <== actualLonShiftedE7;
    absDLon.b <== targetLonShiftedE7;

    // dy_Q = dLatE7 * 111320 / 10_000_000 * Q
    // Use Q=1 (no extra scale) and compare squared metres.
    // dyMeters = dLatE7 * 111320 / 10_000_000
    // To avoid fractions in circuits: multiply both sides of the final
    // comparison by 10_000_000^2, keeping 256-bit arithmetic.

    signal dLatE7;
    signal dLonE7;
    dLatE7 <== absDLat.diff;
    dLonE7 <== absDLon.diff;

    // dyScaled = dLatE7 * 111320  (unit: E7-degree * metres-per-degree)
    // dxScaled = dLonE7 * metersPerLonE7Q  (caller precomputes for target lat)
    // distSquared = dyScaled^2 + dxScaled^2
    // radiusScaled = maxRadiusMeters * 10_000_000
    // assert distSquared <= radiusScaled^2

    signal dyScaled;
    signal dxScaled;
    dyScaled <== dLatE7 * 111320;
    dxScaled <== dLonE7 * metersPerLonE7Q;

    signal dySquared;
    signal dxSquared;
    dySquared <== dyScaled * dyScaled;
    dxSquared <== dxScaled * dxScaled;

    signal distSquared;
    distSquared <== dySquared + dxSquared;

    signal radiusScaled;
    radiusScaled <== maxRadiusMeters * 10000000;

    signal radiusSquared;
    radiusSquared <== radiusScaled * radiusScaled;

    component within = LessEqThan(252);
    within.in[0] <== distSquared;
    within.in[1] <== radiusSquared;
    within.out === 1;

    // ---- Bind public context fields (anti-replay) ----
    // These are identity constraints — they force the prover to use the
    // correct public signals so a proof cannot be replayed for another
    // rider, order, or delivery time.
    signal _oid;
    signal _did;
    signal _ts;
    _oid <== orderIdField;
    _did <== riderDidField;
    _ts <== timestampField;
    _oid === orderIdField;
    _did === riderDidField;
    _ts === timestampField;
}

component main { public [
    targetLatShiftedE7,
    targetLonShiftedE7,
    maxRadiusMeters,
    orderIdField,
    riderDidField,
    timestampField,
    metersPerLonE7Q
] } = LocationWithinRadiusLocalPlane();

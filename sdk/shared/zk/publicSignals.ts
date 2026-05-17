/**
 * Shared ZK utilities for public signal encoding.
 * These must match exactly what the Circom circuit and Solidity DisputeResolver expect.
 */

export const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const LAT_OFFSET_E7 = 900_000_000n;
export const LON_OFFSET_E7 = 1_800_000_000n;

export function latToShifted(latE7: number): bigint {
  if (latE7 < -900_000_000 || latE7 > 900_000_000) {
    throw new Error(`Invalid latitude E7: ${latE7}`);
  }
  return BigInt(latE7) + LAT_OFFSET_E7;
}

export function lonToShifted(lonE7: number): bigint {
  if (lonE7 < -1_800_000_000 || lonE7 > 1_800_000_000) {
    throw new Error(`Invalid longitude E7: ${lonE7}`);
  }
  return BigInt(lonE7) + LON_OFFSET_E7;
}

/**
 * Compute the longitude scale factor at a given latitude.
 * metersPerLonE7 = 111_320 * cos(lat_radians) / 10_000_000 * 10_000_000
 *                = 111_320 * cos(lat_radians) (rounded to integer)
 *
 * In the circuit: dxScaled = dLonE7 * metersPerLonE7Q
 * so this is "meters per 1e-7 degree of longitude at targetLat".
 */
export function metersPerLonE7AtLat(latE7: number): number {
  const latRad = (latE7 / 10_000_000) * (Math.PI / 180);
  return Math.round(111_320 * Math.cos(latRad));
}

/**
 * Build the 6 public signals in the order expected by the circuit and contract.
 */
export function buildPublicSignals(params: {
  targetLatE7: number;
  targetLonE7: number;
  radiusMeters: number;
  orderIdHash: string;
  riderDidHash: string;
  timestampHash: string;
}): string[] {
  const orderIdField = BigInt(params.orderIdHash) % SNARK_SCALAR_FIELD;
  const riderDidField = BigInt(params.riderDidHash) % SNARK_SCALAR_FIELD;
  const timestampField = BigInt(params.timestampHash) % SNARK_SCALAR_FIELD;

  return [
    latToShifted(params.targetLatE7).toString(),
    lonToShifted(params.targetLonE7).toString(),
    String(params.radiusMeters),
    orderIdField.toString(),
    riderDidField.toString(),
    timestampField.toString()
  ];
}

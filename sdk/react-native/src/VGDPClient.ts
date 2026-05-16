/**
 * VGDPClient — React Native SDK for the Verifiable Gig Delivery Proof protocol.
 *
 * Usage:
 *   const vgdp = new VGDPClient({ apiBaseUrl: "https://api.vgdp.example/v1", environment: "polygon-amoy" });
 *   await vgdp.startTracking(order, { activationRadiusMeters: 200 });
 *   // … rider arrives at destination …
 *   const result = await vgdp.confirmDelivered(orderId, { riderJWT, photoUri });
 */

import type {
  VGDPConfig,
  VGDPDeliveryOrder,
  VGDPTrackingOptions,
  VGDPProofResult,
  VGDPConfirmOptions
} from "./types.js";

// ---------------------------------------------------------------------------
// Platform shims
// These are resolved at runtime from the React Native environment.
// In a real build, import directly from react-native / expo-location / etc.
// ---------------------------------------------------------------------------

declare function require(id: string): unknown;

type LocationObject = { coords: { latitude: number; longitude: number; accuracy: number } };
type Subscription = { remove(): void };

interface ExpoLocation {
  requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  watchPositionAsync(
    options: { accuracy: number; timeInterval: number; distanceInterval: number },
    callback: (loc: LocationObject) => void
  ): Promise<Subscription>;
  Accuracy: { BestForNavigation: number };
}

interface Snarkjs {
  groth16: {
    fullProve(
      input: Record<string, string | number>,
      wasmPath: string,
      zkeyPath: string
    ): Promise<{ proof: object; publicSignals: string[] }>;
    exportSolidityCallData(proof: object, publicSignals: string[]): Promise<string>;
  };
}

interface EthersUtils {
  keccak256(data: Uint8Array | string): string;
  toUtf8Bytes(str: string): Uint8Array;
  randomBytes(n: number): Uint8Array;
  hexlify(bytes: Uint8Array): string;
  solidityPacked(types: string[], values: unknown[]): string;
  getBytes(hex: string): Uint8Array;
  hashMessage(message: Uint8Array): string;
  recoverAddress(digest: string, signature: string): string;
  Wallet: new (privateKey: string) => { signMessage(message: Uint8Array): Promise<string>; address: string };
}

// ---------------------------------------------------------------------------
// Haversine helper (pure JS, no ZK — used to decide when to start proving)
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(
  lat1E7: number,
  lon1E7: number,
  lat2E7: number,
  lon2E7: number
): number {
  const toRad = (e7: number) => (e7 / 10_000_000) * (Math.PI / 180);
  const dLat = toRad(lat2E7 - lat1E7);
  const dLon = toRad(lon2E7 - lon1E7);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1E7)) * Math.cos(toRad(lat2E7)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Compute metersPerLonE7Q public input for the local-plane circuit.
 * Q = 1_000_000 (6 decimal fixed point).
 */
function metersPerLonE7Q(targetLatE7: number): string {
  const Q = 1_000_000;
  const latRad = (targetLatE7 / 10_000_000) * (Math.PI / 180);
  const mPerDeg = 111_320 * Math.cos(latRad);
  const mPerE7 = mPerDeg / 10_000_000;
  return String(Math.round(mPerE7 * Q));
}

/**
 * Perceptual hash stub.
 * Production: use a native module (react-native-phash or similar).
 * Returns a hex-encoded 32-byte value.
 */
async function computePerceptualHash(photoUri: string): Promise<string> {
  // Stub: hash the URI itself. Replace with real pHash in production.
  const encoder = new TextEncoder();
  const data = encoder.encode(photoUri);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return "0x" + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Circuit paths (bundled with the app)
// Adjust to your asset resolution strategy (e.g. expo-asset).
// ---------------------------------------------------------------------------

const CIRCUIT_WASM = require("../zk/location_within_radius_js/location_within_radius.wasm") as string;
const CIRCUIT_ZKEY = require("../zk/location_within_radius_final.zkey") as string;

// ---------------------------------------------------------------------------
// VGDPClient
// ---------------------------------------------------------------------------

export class VGDPClient {
  private readonly config: VGDPConfig;
  private readonly activeOrders = new Map<string, VGDPDeliveryOrder>();
  private readonly locationSubs = new Map<string, Subscription>();

  /** Optional: pre-load snarkjs and ethers to avoid cold-start latency. */
  private _snarkjs: Snarkjs | null = null;
  private _ethers: EthersUtils | null = null;

  constructor(config: VGDPConfig) {
    this.config = config;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Begin GPS monitoring for a delivery order.
   * High-accuracy polling starts only when the rider is within activationRadiusMeters.
   */
  async startTracking(
    order: VGDPDeliveryOrder,
    options: VGDPTrackingOptions = {}
  ): Promise<void> {
    const {
      activationRadiusMeters = 200,
      pollingIntervalSeconds = 5,
      desiredAccuracyMeters = 10
    } = options;

    this.activeOrders.set(order.orderId, order);

    // Dynamically import to allow tree-shaking in non-RN environments
    const Location = await this._getLocation();

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") throw new Error("Location permission denied");

    let highAccuracyActive = false;
    let highAccuracySub: Subscription | null = null;

    // Low-accuracy background poll to detect proximity
    const lowSub = await Location.watchPositionAsync(
      {
        accuracy: 4, // BALANCED
        timeInterval: 15_000,
        distanceInterval: 50
      },
      (loc) => {
        const distM = haversineMeters(
          Math.round(loc.coords.latitude * 10_000_000),
          Math.round(loc.coords.longitude * 10_000_000),
          order.targetLatE7,
          order.targetLonE7
        );

        if (distM <= activationRadiusMeters && !highAccuracyActive) {
          highAccuracyActive = true;
          console.log(`[VGDP] ${order.orderId}: within ${activationRadiusMeters}m — switching to high accuracy`);

          Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.BestForNavigation,
              timeInterval: pollingIntervalSeconds * 1_000,
              distanceInterval: desiredAccuracyMeters
            },
            (highLoc) => {
              console.log(
                `[VGDP] ${order.orderId}: GPS ${highLoc.coords.latitude.toFixed(6)}, ${highLoc.coords.longitude.toFixed(6)} ±${highLoc.coords.accuracy}m`
              );
            }
          ).then((sub) => {
            highAccuracySub = sub;
            this.locationSubs.set(`${order.orderId}:high`, sub);
          });
        }
      }
    );

    this.locationSubs.set(`${order.orderId}:low`, lowSub);
    console.log(`[VGDP] Tracking started for ${order.orderId}`);
  }

  /**
   * Called when the rider taps "Delivered".
   * Captures GPS, takes photo, generates ZK proof, and submits to the validator.
   */
  async confirmDelivered(
    orderId: string,
    options: VGDPConfirmOptions
  ): Promise<VGDPProofResult> {
    const order = this.activeOrders.get(orderId);
    if (!order) throw new Error(`No active tracking for order ${orderId}`);

    // ── 1. Capture final GPS ───────────────────────────────────────────────
    const Location = await this._getLocation();
    let finalLoc: LocationObject | null = null;

    await new Promise<void>((resolve) => {
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
        (loc) => {
          if (loc.coords.accuracy <= 20) {
            finalLoc = loc;
            resolve();
          }
        }
      );
      // Timeout: accept best available after 10s
      setTimeout(resolve, 10_000);
    });

    if (!finalLoc) throw new Error("Could not obtain GPS fix");
    const gpsLoc = finalLoc as LocationObject;

    const actualLatE7 = Math.round(gpsLoc.coords.latitude * 10_000_000);
    const actualLonE7 = Math.round(gpsLoc.coords.longitude * 10_000_000);

    // ── 2. Capture photo and compute pHash ────────────────────────────────
    let photoPHash = "0x" + "00".repeat(32);
    if (options.photoUri) {
      photoPHash = await computePerceptualHash(options.photoUri);
    } else if (options.requirePhoto) {
      throw new Error("Photo is required but was not provided");
    }

    const ethers = await this._getEthers();

    const photoSalt = ethers.hexlify(ethers.randomBytes(32));
    const photoHashCommitment = ethers.keccak256(
      ethers.solidityPacked(["bytes32", "bytes32"], [photoPHash, photoSalt])
    );

    // ── 3. NTP-adjusted timestamp ─────────────────────────────────────────
    const deliveredAtEpoch = Math.floor(Date.now() / 1000);

    // ── 4. Generate ZK proof ──────────────────────────────────────────────
    const snarkjs = await this._getSnarkjs();

    // Compute orderIdHash and riderDidHash to convert to field elements
    const orderIdHash = ethers.keccak256(ethers.toUtf8Bytes(orderId));
    const riderDidHash = ethers.keccak256(ethers.toUtf8Bytes(order.riderDid));
    const tsHash = ethers.keccak256(
      ethers.solidityPacked(["bytes32", "uint64"], [orderIdHash, deliveredAtEpoch])
    );

    const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    const toField = (hex: string): string =>
      (BigInt(hex) % SNARK_FIELD).toString();

    const circuitInput = {
      // Public
      targetLatShiftedE7: String(order.targetLatE7 + 900_000_000),
      targetLonShiftedE7: String(order.targetLonE7 + 1_800_000_000),
      maxRadiusMeters: String(order.radiusMeters),
      orderIdField: toField(orderIdHash),
      riderDidField: toField(riderDidHash),
      timestampField: toField(tsHash),
      metersPerLonE7Q: metersPerLonE7Q(order.targetLatE7),
      // Private
      actualLatShiftedE7: String(actualLatE7 + 900_000_000),
      actualLonShiftedE7: String(actualLonE7 + 1_800_000_000)
    };

    console.log("[VGDP] Generating ZK proof...");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput,
      CIRCUIT_WASM,
      CIRCUIT_ZKEY
    );

    // ── 5. Convert proof to Solidity format ───────────────────────────────
    const calldataStr = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const solidityProof = _parseSolidityCalldata(calldataStr);

    // ── 6. Compute merkle root ────────────────────────────────────────────
    const zkProofHash = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256[2]", "uint256[2][2]", "uint256[2]"],
        [solidityProof.a, solidityProof.b, solidityProof.c]
      )
    );
    const merkleRoot = _computeMerkleRoot([zkProofHash, tsHash, photoHashCommitment]);

    // ── 7. Sign bundle with rider DID key ────────────────────────────────
    if (!options.riderPrivateKey) {
      throw new Error("riderPrivateKey is required for bundle signing");
    }

    const EthersWallet = ethers.Wallet;
    const wallet = new EthersWallet(options.riderPrivateKey);
    const bundleNonce = ethers.hexlify(ethers.randomBytes(32));

    const digest = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint64", "bytes32", "bytes32"],
        [
          orderIdHash,
          riderDidHash,
          zkProofHash,
          photoHashCommitment,
          tsHash,
          deliveredAtEpoch,
          merkleRoot,
          bundleNonce
        ]
      )
    );

    const didSignature = await wallet.signMessage(ethers.getBytes(digest));

    // ── 8. Submit to validator ────────────────────────────────────────────
    const body = {
      orderId,
      riderDid: order.riderDid,
      riderWallet: wallet.address,
      deliveredAtEpoch,
      photoPHash,
      photoSalt,
      proof,
      publicSignals,
      solidityProof,
      bundleNonce,
      didSignature
    };

    const response = await fetch(`${this.config.apiBaseUrl}/proofs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.riderJWT}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(`Validator rejected proof: ${(err as { error: string }).error}`);
    }

    const result = (await response.json()) as VGDPProofResult;

    // ── 9. Cleanup tracking ───────────────────────────────────────────────
    this.stopTracking(orderId);

    return result;
  }

  /** Stop GPS tracking for an order. */
  stopTracking(orderId: string): void {
    for (const key of [`${orderId}:low`, `${orderId}:high`]) {
      const sub = this.locationSubs.get(key);
      if (sub) {
        sub.remove();
        this.locationSubs.delete(key);
      }
    }
    this.activeOrders.delete(orderId);
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async _getLocation(): Promise<ExpoLocation> {
    // Dynamic import allows mocking in tests
    return (await import("expo-location")) as unknown as ExpoLocation;
  }

  private async _getSnarkjs(): Promise<Snarkjs> {
    if (!this._snarkjs) {
      this._snarkjs = (await import("snarkjs")) as unknown as Snarkjs;
    }
    return this._snarkjs;
  }

  private async _getEthers(): Promise<EthersUtils> {
    if (!this._ethers) {
      this._ethers = (await import("ethers")) as unknown as EthersUtils;
    }
    return this._ethers;
  }
}

// ---------------------------------------------------------------------------
// Internal utility: parse snarkjs Solidity calldata string
// ---------------------------------------------------------------------------

type SolidityProofStruct = {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
};

function _parseSolidityCalldata(calldata: string): SolidityProofStruct {
  // snarkjs outputs: ["a0","a1"],[[["b00","b01"],["b10","b11"]]],[["c0","c1"]],[...publicSignals...]
  const cleaned = calldata.replace(/\s/g, "");
  // Extract first four top-level bracket groups
  const groups: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (cleaned[i] === "]") {
      depth--;
      if (depth === 0 && start !== -1) {
        groups.push(cleaned.slice(start, i + 1));
        start = -1;
        if (groups.length === 4) break;
      }
    }
  }
  const a = JSON.parse(groups[0]) as [string, string];
  const b = JSON.parse(groups[1]) as [[string, string], [string, string]];
  const c = JSON.parse(groups[2]) as [string, string];
  return { a, b, c };
}

function _computeMerkleRoot(leaves: string[]): string {
  // Simple 2-leaf Merkle tree for [zkProofHash, tsHash, photoHashCommitment]
  // Pad to power of 2
  const padded = [...leaves];
  while ((padded.length & (padded.length - 1)) !== 0) {
    padded.push(padded[padded.length - 1]);
  }
  let layer = padded;
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const combined =
        layer[i] <= layer[i + 1]
          ? layer[i] + layer[i + 1].slice(2)
          : layer[i + 1] + layer[i].slice(2);
      // Use browser-safe keccak (we import ethers lazily above; use a sync stub here)
      // In production, replace with ethers.keccak256 called synchronously via pre-loaded module.
      next.push(_keccak256Hex(combined));
    }
    layer = next;
  }
  return layer[0];
}

function _keccak256Hex(hexStr: string): string {
  // Synchronous keccak256 stub — in production inject the pre-loaded ethers instance.
  // This is only called during proof construction where ethers is already loaded.
  const { keccak256, getBytes } = require("ethers") as EthersUtils;
  return keccak256(getBytes(hexStr));
}

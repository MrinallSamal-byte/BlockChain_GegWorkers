import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ...actual,
    JsonRpcProvider: vi.fn(() => ({ getNetwork: vi.fn().mockResolvedValue({ chainId: 80002n }) })),
    Wallet: vi.fn(() => ({ provider: {} })),
    Contract: vi.fn(() => ({
      proofIdForOrder: vi.fn().mockResolvedValue(actual.ZeroHash),
      registerProof: vi.fn().mockResolvedValue({ hash: "0xabc", wait: vi.fn().mockResolvedValue({ blockNumber: 100 }) }),
      getAddress: vi.fn().mockResolvedValue("0x1234000000000000000000000000000000000000"),
      on: vi.fn()
    }))
  };
});

vi.mock("snarkjs", () => ({
  groth16: {
    verify: vi.fn().mockResolvedValue(true)
  }
}));

vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn((path: string) => {
      if (path.includes("verification_key")) return JSON.stringify({ protocol: "groth16" });
      if (path.includes("rider_jwt")) return "test-public-key";
      return "{}";
    }),
    existsSync: vi.fn().mockReturnValue(true)
  }
}));

process.env.POLYGON_RPC_URL = "https://polygon-amoy.drpc.org";
process.env.VALIDATOR_PRIVATE_KEY = "0x" + "1".repeat(64);
process.env.REGISTRY_ADDRESS = "0x" + "0".repeat(40);
process.env.DISPUTE_RESOLVER_ADDRESS = "0x" + "2".repeat(40);
process.env.REPUTATION_ADDRESS = "0x" + "3".repeat(40);
process.env.VERIFICATION_KEY_PATH = "./zk/verification_key.json";
process.env.RIDER_JWT_PUBLIC_KEY_PATH = "./keys/rider_jwt_public.pem";
process.env.COMPANY_API_KEYS = "swiggy_test:test_api_key_32bytes_abcdefgh12345";
process.env.WEBHOOK_SIGNING_SECRET = "test_webhook_secret_32bytes_long!";
process.env.MAX_CLOCK_SKEW_SECONDS = "300";

describe("metersPerLonE7AtLat", () => {
  it("returns approximately 111320 at equator", async () => {
    const { metersPerLonE7AtLat } = await import("../../sdk/shared/zk/publicSignals.js");
    const result = metersPerLonE7AtLat(0);
    expect(result).toBeGreaterThan(111300);
    expect(result).toBeLessThan(111340);
  });

  it("returns ~0 at poles", async () => {
    const { metersPerLonE7AtLat } = await import("../../sdk/shared/zk/publicSignals.js");
    const result = metersPerLonE7AtLat(900000000);
    expect(result).toBeLessThan(5);
  });

  it("returns ~108479 at Bhubaneswar lat", async () => {
    const { metersPerLonE7AtLat } = await import("../../sdk/shared/zk/publicSignals.js");
    const result = metersPerLonE7AtLat(129715990);
    expect(result).toBeGreaterThan(108000);
    expect(result).toBeLessThan(109000);
  });
});

describe("buildPublicSignals", () => {
  it("produces 6 string signals", async () => {
    const { buildPublicSignals } = await import("../../sdk/shared/zk/publicSignals.js");
    const signals = buildPublicSignals({
      targetLatE7: 129715990,
      targetLonE7: 775947220,
      radiusMeters: 75,
      orderIdHash: "0x" + "ab".repeat(32),
      riderDidHash: "0x" + "cd".repeat(32),
      timestampHash: "0x" + "ef".repeat(32)
    });
    expect(signals).toHaveLength(6);
    signals.forEach((s) => expect(typeof s).toBe("string"));
    expect(signals[2]).toBe("75");
  });
});

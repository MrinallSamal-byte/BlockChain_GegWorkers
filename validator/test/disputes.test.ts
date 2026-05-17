import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/config.js", async () => {
  const { ethers } = await import("ethers");
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    PORT: 8080,
    SNARK_SCALAR_FIELD: 21888242871839275222246405745257275088548364400416034343698204186575808495617n,
    requiredEnv: (name: string) => {
      const vars: Record<string, string> = {
        POLYGON_RPC_URL: "http://localhost:8545",
        REGISTRY_ADDRESS: "0x" + "1".repeat(40),
        DISPUTE_RESOLVER_ADDRESS: "0x" + "2".repeat(40),
        REPUTATION_ADDRESS: "0x" + "3".repeat(40),
        VALIDATOR_PRIVATE_KEY: "0x" + "a".repeat(64),
        VERIFICATION_KEY_PATH: "./zk/verification_key.json",
        WEBHOOK_SIGNING_SECRET: "testsecret"
      };
      if (!vars[name]) throw new Error(`Missing env: ${name}`);
      return vars[name];
    },
    provider: { getTransactionCount: vi.fn().mockResolvedValue(0), getNetwork: vi.fn().mockResolvedValue({ chainId: 80002n }) },
    validatorWallet: { address: "0x" + "a".repeat(40) },
    registry: { on: vi.fn(), proofIdForOrder: vi.fn().mockResolvedValue(ethers.ZeroHash), getAddress: vi.fn().mockResolvedValue("0x" + "1".repeat(40)) },
    disputeResolverWithSigner: {
      resolveDispute: vi.fn(),
      interface: { parseLog: vi.fn().mockReturnValue({ name: "DisputeResolved", args: { outcome: 1n } }) }
    },
    reputation: { trustScoreWithConsent: vi.fn() },
    orders: new Map([
      ["swiggy_test:TEST-001", {
        companyId: "swiggy_test",
        orderId: "TEST-001",
        orderIdHash: "0x" + "0".repeat(64),
        riderId: "rider1",
        riderDid: "did:ethr:0xabc",
        riderDidHash: "0x" + "b".repeat(64),
        targetLatE7: 129715990,
        targetLonE7: 775947220,
        radiusMeters: 75,
        createdAtEpoch: Math.floor(Date.now() / 1000),
        proofId: "0x" + "c".repeat(64),
        status: "proof_submitted"
      }]
    ]),
    orderKey: (c: string, o: string) => `${c}:${o}`,
    hashUtf8: (v: string) => ethers.keccak256(ethers.toUtf8Bytes(v)),
    httpError: (status: number, message: string) => { const e = new Error(message) as any; e.status = status; return e; },
    safeEqual: (a: string, b: string) => a === b,
    companyFromApiKey: (req: any) => {
      const key = req.header("x-vgdp-api-key");
      if (!key) { const e = new Error("Missing X-VGDP-Api-Key") as any; e.status = 401; throw e; }
      if (key !== "test-company-key") { const e = new Error("Invalid API key") as any; e.status = 403; throw e; }
      return "swiggy_test";
    },
    verifyRiderJwt: vi.fn().mockReturnValue({ riderId: "rider1" }),
    verificationKey: {},
    riderJwtPublicKey: undefined,
    disputeResolverAbi: [],
    reputationAbi: [],
    disputeResolver: {}
  };
});

vi.mock("../src/webhooks/dispatcher.js", () => ({
  sendWebhook: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../src/blockchain/eventIndexer.js", () => ({
  startEventIndexer: vi.fn()
}));

const { default: app } = await import("../src/server.js");

const VALID_PROOF = {
  a: ["0x0000000000000000000000000000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000000000000000000000000000002"],
  b: [["0x0000000000000000000000000000000000000000000000000000000000000003", "0x0000000000000000000000000000000000000000000000000000000000000004"], ["0x0000000000000000000000000000000000000000000000000000000000000005", "0x0000000000000000000000000000000000000000000000000000000000000006"]],
  c: ["0x0000000000000000000000000000000000000000000000000000000000000007", "0x0000000000000000000000000000000000000000000000000000000000000008"]
};

describe("POST /disputes/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with outcome when proof is submitted", async () => {
    const { disputeResolverWithSigner } = await import("../src/config.js");
    (disputeResolverWithSigner.resolveDispute as any).mockResolvedValue({
      hash: "0x" + "d".repeat(64),
      wait: vi.fn().mockResolvedValue({
        logs: [{ topics: [], data: "0x" }]
      })
    });

    const res = await request(app)
      .post("/disputes/resolve")
      .set("x-vgdp-api-key", "test-company-key")
      .send({
        orderId: "TEST-001",
        proofId: "0x" + "c".repeat(64),
        expectedLatE7: 129715990,
        expectedLonE7: 775947220,
        radiusMeters: 75,
        reasonCode: "ORDER_NOT_RECEIVED",
        solidityProof: VALID_PROOF
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("proofId");
    expect(res.body).toHaveProperty("outcome");
    expect(res.body).toHaveProperty("transactionHash");
  });

  it("returns 401 when API key is missing", async () => {
    const res = await request(app)
      .post("/disputes/resolve")
      .send({ orderId: "TEST-001" });

    expect(res.status).toBe(401);
  });

  it("returns 404 when order does not exist", async () => {
    const res = await request(app)
      .post("/disputes/resolve")
      .set("x-vgdp-api-key", "test-company-key")
      .send({
        orderId: "NONEXISTENT-999",
        proofId: "0x" + "c".repeat(64),
        expectedLatE7: 129715990,
        expectedLonE7: 775947220,
        radiusMeters: 75,
        reasonCode: "ORDER_NOT_RECEIVED",
        solidityProof: VALID_PROOF
      });

    expect(res.status).toBe(404);
  });
});

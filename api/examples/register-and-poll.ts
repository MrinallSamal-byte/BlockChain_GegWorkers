import { ethers } from "ethers";

const VGDP_API_BASE = "https://api.vgdp.example/v1";
const VGDP_API_KEY = process.env.VGDP_API_KEY!;

async function main() {
  console.log("=== VGDP API Example: Register Order ===");

  const registerRes = await fetch(`${VGDP_API_BASE}/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vgdp-api-key": VGDP_API_KEY
    },
    body: JSON.stringify({
      orderId: `DEMO-${Date.now()}`,
      riderId: "rider_demo_001",
      riderDid: "did:ethr:0x8b6A000000000000000000000000000000000001",
      targetLatE7: 129715990,
      targetLonE7: 775947220,
      radiusMeters: 75,
      webhookUrl: "https://webhook.site/your-test-uuid"
    })
  });

  if (!registerRes.ok) {
    const err = await registerRes.json();
    console.error("Order registration failed:", err);
    process.exit(1);
  }

  const order = await registerRes.json();
  console.log("Order registered:", JSON.stringify(order, null, 2));

  console.log("\n=== Poll Proof Status ===");

  const statusRes = await fetch(
    `${VGDP_API_BASE}/orders/${encodeURIComponent(order.orderId)}/proof`,
    {
      headers: { "x-vgdp-api-key": VGDP_API_KEY }
    }
  );

  const status = await statusRes.json();
  console.log("Proof status:", JSON.stringify(status, null, 2));

  console.log("\n=== On-chain Verification (read-only) ===");
  console.log("To verify independently, run:");
  console.log(`  const proof = await registry.getProof("${status.proofId ?? "<proofId>"}");`);
  console.log("  console.log(proof.status); // 1 = Registered, 2 = Disputed, 3 = Resolved");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { companyFromApiKey } from "../config.js";
import { reputation } from "../config.js";

const router: ExpressRouter = Router();

export const RiderTrustHeaderSchema = z.object({
  riderDidHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  riderWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  consentDeadline: z.coerce.number().int().positive(),
  consentSignature: z.string().regex(/^0x[0-9a-fA-F]+$/)
});

router.get("/:riderId/trust", async (req, res, next) => {
  try {
    companyFromApiKey(req);

    const headers = RiderTrustHeaderSchema.parse({
      riderDidHash: req.header("x-rider-did-hash"),
      riderWallet: req.header("x-rider-wallet"),
      consentDeadline: req.header("x-rider-consent-deadline"),
      consentSignature: req.header("x-rider-consent-signature")
    });

    const { riderId } = req.params;

    const score: number = await reputation.trustScoreWithConsent(
      headers.riderDidHash,
      headers.riderWallet,
      headers.consentDeadline,
      headers.consentSignature
    );

    res.json({
      riderId,
      riderDidHash: headers.riderDidHash,
      score: Number(score),
      scale: "0-100",
      consentVerified: true
    });
  } catch (err) {
    next(err);
  }
});

export default router;

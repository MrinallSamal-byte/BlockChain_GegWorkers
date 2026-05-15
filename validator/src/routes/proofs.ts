import express from "express";
import { verifyRiderJwt } from "../config.js";
import { ProofBundleSchema } from "../auth/schemas.js";
import { submitProof } from "../blockchain/registryClient.js";

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const rider = verifyRiderJwt(req);
    const body = ProofBundleSchema.parse(req.body);
    const result = await submitProof(body, rider.riderId, rider.riderDid);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;

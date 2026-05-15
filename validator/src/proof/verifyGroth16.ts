import * as snarkjs from "snarkjs";
import { verificationKey } from "../config.js";

export async function verifyGroth16(
  proof: object,
  publicSignals: (string | number)[]
): Promise<boolean> {
  return snarkjs.groth16.verify(verificationKey, publicSignals.map(String), proof);
}

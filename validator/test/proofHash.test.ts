import { describe, it, expect } from "vitest";
import { photoCommitment, solidityProofHash, computeMerkleRoot } from "../src/proof/proofHash.js";
import { ethers } from "ethers";

describe("photoCommitment", () => {
  it("matches on-chain keccak256(abi.encodePacked(photoPHash, salt))", () => {
    const photoPHash = "0x" + "aa".repeat(32);
    const salt = "0x" + "bb".repeat(32);
    const result = photoCommitment(photoPHash, salt);
    const expected = ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [photoPHash, salt]));
    expect(result).toBe(expected);
  });
});

describe("computeMerkleRoot", () => {
  it("returns hash of single leaf", () => {
    const leaf = "0x" + "cc".repeat(32);
    const root = computeMerkleRoot([leaf]);
    expect(root).toHaveLength(66);
  });

  it("is deterministic for same leaves in any order", () => {
    const a = "0x" + "aa".repeat(32);
    const b = "0x" + "bb".repeat(32);
    const root1 = computeMerkleRoot([a, b]);
    const root2 = computeMerkleRoot([b, a]);
    expect(root1).toBe(root2);
  });

  it("produces different roots for different leaves", () => {
    const a = "0x" + "aa".repeat(32);
    const b = "0x" + "bb".repeat(32);
    const c = "0x" + "cc".repeat(32);
    const root1 = computeMerkleRoot([a, b]);
    const root2 = computeMerkleRoot([a, c]);
    expect(root1).not.toBe(root2);
  });
});

describe("solidityProofHash", () => {
  it("returns a bytes32 hex string", () => {
    const proof = {
      a: ["1", "2"],
      b: [["3", "4"], ["5", "6"]],
      c: ["7", "8"]
    };
    const hash = solidityProofHash(proof as any);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

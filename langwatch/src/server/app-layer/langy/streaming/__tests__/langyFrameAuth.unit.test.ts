/**
 * The authenticated frame contract is a SECURITY boundary and a cross-language
 * one: the Go worker signs, this TS relay code verifies. These tests pin the
 * exact MACs from specs/langy/langy-frame-auth.vectors.json — the same file a Go
 * test asserts against — so Go and TS can never silently diverge, and they lock
 * the properties the construction exists to guarantee (tamper-evidence,
 * field-boundary integrity, constant-time reject of garbage).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeFrameMac,
  mintRunToken,
  newFrameNonce,
  signFrame,
  verifyFrame,
  type LangyFrameEnvelope,
  type LangyFrameSigned,
} from "../langyFrameAuth";

interface Vectors {
  vectors: Array<LangyFrameSigned & { name: string; runToken: string; mac: string }>;
  fieldShift: {
    runToken: string;
    a: LangyFrameSigned & { mac: string };
    b: LangyFrameSigned & { mac: string };
  };
}

// Single source of truth, shared with the Go suite. cwd under vitest is
// `langwatch/`, so the repo-root `specs/` dir is one level up.
const VECTORS: Vectors = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "..", "specs", "langy", "langy-frame-auth.vectors.json"),
    "utf8",
  ),
) as Vectors;

const identityOf = (f: LangyFrameSigned) => ({
  projectId: f.projectId,
  userId: f.userId,
  conversationId: f.conversationId,
  turnId: f.turnId,
});

describe("computeFrameMac", () => {
  describe("given the cross-language test vectors", () => {
    it.each(VECTORS.vectors.map((v) => [v.name, v] as const))(
      "reproduces the pinned MAC for %s (Go ≡ TS ≡ oracle)",
      (_name, v) => {
        expect(computeFrameMac(v.runToken, v)).toBe(v.mac);
      },
    );
  });

  describe("given two field tuples that share a raw concatenation", () => {
    it("produces different MACs — length-prefixing makes the fields unambiguous", () => {
      const { runToken, a, b } = VECTORS.fieldShift;
      expect(computeFrameMac(runToken, a)).toBe(a.mac);
      expect(computeFrameMac(runToken, b)).toBe(b.mac);
      // ("ab","c") and ("a","bc") concatenate identically but must not collide.
      expect(a.mac).not.toBe(b.mac);
    });
  });
});

describe("signFrame / verifyFrame", () => {
  const runToken = VECTORS.vectors[0]!.runToken;
  const identity = identityOf(VECTORS.vectors[0]!);

  describe("given a frame this code signed", () => {
    it("verifies it and mints a fresh unique nonce per frame", () => {
      const one = signFrame(runToken, identity, "payload-1");
      const two = signFrame(runToken, identity, "payload-1");
      expect(verifyFrame(runToken, one)).toBe(true);
      expect(verifyFrame(runToken, two)).toBe(true);
      // Same inputs, different nonce ⇒ different MAC ⇒ replay of `one` can't
      // masquerade as `two`.
      expect(one.frameNonce).not.toBe(two.frameNonce);
      expect(one.mac).not.toBe(two.mac);
    });
  });

  describe("given the payload is tampered after signing", () => {
    it("fails verification — the body is inside the MAC", () => {
      const frame = signFrame(runToken, identity, '{"type":"delta","text":"hi"}');
      const tampered: LangyFrameEnvelope = {
        ...frame,
        payload: '{"type":"delta","text":"HACKED"}',
      };
      expect(verifyFrame(runToken, tampered)).toBe(false);
    });
  });

  describe("given an identity field is tampered after signing", () => {
    it.each(["projectId", "userId", "conversationId", "turnId", "frameNonce"] as const)(
      "fails verification when %s is changed",
      (field) => {
        const frame = signFrame(runToken, identity, "p");
        const tampered = { ...frame, [field]: frame[field] + "x" };
        expect(verifyFrame(runToken, tampered)).toBe(false);
      },
    );
  });

  describe("given a different runToken than the one that signed", () => {
    it("fails verification", () => {
      const frame = signFrame(runToken, identity, "p");
      expect(verifyFrame(mintRunToken(), frame)).toBe(false);
    });
  });

  describe("given a malformed MAC", () => {
    it.each([
      ["empty", ""],
      ["too short", "abcd"],
      ["non-hex", "z".repeat(64)],
      ["wrong length (63)", "a".repeat(63)],
    ])("returns false without throwing for a %s mac", (_name, mac) => {
      const frame = signFrame(runToken, identity, "p");
      expect(verifyFrame(runToken, { ...frame, mac })).toBe(false);
    });
  });
});

describe("mintRunToken", () => {
  it("returns 32 bytes as 64 hex chars, unique across calls", () => {
    const a = mintRunToken();
    const b = mintRunToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("newFrameNonce", () => {
  it("returns 16 bytes as 32 hex chars, unique across calls", () => {
    const a = newFrameNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(newFrameNonce());
  });
});

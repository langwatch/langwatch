/** The portable SHA-256 the tenant fence keys hash with agrees with Node's. */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256Hex } from "../sha256.ts";

const node = (text: string) => createHash("sha256").update(text).digest("hex");

describe("sha256Hex", () => {
  describe("given inputs across the block boundaries", () => {
    it.each([
      "",
      "abc",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(64),
      "a".repeat(1_000),
      "proj_a@1700000000000-|proj_b@0-1800000000000",
      "naïve ünïcode 漢字",
      "astral 😀 plane",
    ])("matches Node's digest for %j", (text) => {
      expect(sha256Hex(text)).toBe(node(text));
    });
  });
});

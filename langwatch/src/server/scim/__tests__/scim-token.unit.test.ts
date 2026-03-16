import { describe, expect, it } from "vitest";
import { generateScimToken, verifyScimToken } from "../scim-token";

describe("generateScimToken()", () => {
  it("produces a token with the lwscim_ prefix", async () => {
    const { plainToken } = await generateScimToken();

    expect(plainToken).toMatch(/^lwscim_/);
  });

  it("produces a tokenPrefix of 8 characters", async () => {
    const { tokenPrefix } = await generateScimToken();

    expect(tokenPrefix).toHaveLength(8);
    expect(tokenPrefix).toMatch(/^lwscim_[0-9a-f]$/);
  });

  it("produces a bcrypt hash starting with $2b$", async () => {
    const { tokenHash } = await generateScimToken();

    expect(tokenHash).toMatch(/^\$2[ab]\$/);
  });

  it("generates unique tokens on each call", async () => {
    const first = await generateScimToken();
    const second = await generateScimToken();

    expect(first.plainToken).not.toBe(second.plainToken);
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });
});

describe("verifyScimToken()", () => {
  describe("when given a matching token and hash", () => {
    it("returns true", async () => {
      const { plainToken, tokenHash } = await generateScimToken();

      const result = await verifyScimToken({ plainToken, tokenHash });

      expect(result).toBe(true);
    });
  });

  describe("when given a non-matching token", () => {
    it("returns false", async () => {
      const { tokenHash } = await generateScimToken();

      const result = await verifyScimToken({
        plainToken: "lwscim_wrong_token",
        tokenHash,
      });

      expect(result).toBe(false);
    });
  });
});

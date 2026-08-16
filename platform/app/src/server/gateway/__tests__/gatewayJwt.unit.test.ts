/**
 * The gateway token's lifetime. The gateway caches what it verifies here and
 * keeps serving from that cache while the control plane is unreachable, so a
 * token that outlives its key is what lets an expired key keep calling
 * providers through an outage.
 *
 * Spec: specs/ai-gateway/virtual-key-lifecycle.feature
 */

import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type GatewayJwtSubject,
  signGatewayJwt,
  verifyGatewayJwt,
} from "../gatewayJwt";

// Sequential-hex signing fixture for this suite, not a credential.
const SECRET = "0123456789abcdef0123456789abcdef";
const TTL_SECONDS = 15 * 60;

const identity: Omit<GatewayJwtSubject, "notAfter"> = {
  vk_id: "vk_01HZX",
  project_id: "proj_01HZX",
  team_id: "team_01HZX",
  org_id: "org_01HZX",
  principal_id: "user_01HZX",
  revision: "42",
};

function expOf(token: string): number {
  const decoded = jwt.decode(token) as { exp: number };
  return decoded.exp;
}

describe("gateway JWT minting", () => {
  let previousSecret: string | undefined;

  beforeAll(() => {
    previousSecret = process.env.LW_GATEWAY_JWT_SECRET;
    process.env.LW_GATEWAY_JWT_SECRET = SECRET;
  });

  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.LW_GATEWAY_JWT_SECRET;
    } else {
      process.env.LW_GATEWAY_JWT_SECRET = previousSecret;
    }
  });

  describe("when the key expires before the ordinary TTL", () => {
    it("ends the token at the key's expiration date", () => {
      const notAfter = new Date(Date.now() + 5 * 60 * 1000);
      const keyExpiresAt = Math.floor(notAfter.getTime() / 1000);

      const { jwt: token, expiresAt } = signGatewayJwt({
        ...identity,
        notAfter,
      });

      expect(expiresAt).toBe(keyExpiresAt);
      expect(expOf(token)).toBe(keyExpiresAt);
      expect(verifyGatewayJwt(token).vk_expires_at).toBe(keyExpiresAt);
    });
  });

  describe("when the key expires after the ordinary TTL", () => {
    it("keeps the fifteen minute lifetime and still carries the date", () => {
      const notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const nowSeconds = Math.floor(Date.now() / 1000);

      const { jwt: token, expiresAt } = signGatewayJwt({
        ...identity,
        notAfter,
      });

      expect(expiresAt).toBeGreaterThanOrEqual(nowSeconds + TTL_SECONDS - 1);
      expect(expiresAt).toBeLessThanOrEqual(nowSeconds + TTL_SECONDS + 1);
      expect(verifyGatewayJwt(token).vk_expires_at).toBe(
        Math.floor(notAfter.getTime() / 1000),
      );
    });
  });

  /** @scenario "A key with no expiration date keeps the ordinary token lifetime" */
  it("mints the ordinary fifteen minute token for a key that never expires", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const notAfter of [null, undefined]) {
      const { jwt: token, expiresAt } = signGatewayJwt({
        ...identity,
        notAfter,
      });

      expect(expiresAt).toBeGreaterThanOrEqual(nowSeconds + TTL_SECONDS - 1);
      expect(expiresAt).toBeLessThanOrEqual(nowSeconds + TTL_SECONDS + 1);
      expect(expOf(token)).toBe(expiresAt);
      expect(verifyGatewayJwt(token).vk_expires_at).toBeNull();
    }
  });

  describe("when the date has already passed", () => {
    it("mints a token that is already finished rather than one with no lifetime", () => {
      const notAfter = new Date(Date.now() - 60 * 60 * 1000);
      const nowSeconds = Math.floor(Date.now() / 1000);

      const { jwt: token, expiresAt } = signGatewayJwt({
        ...identity,
        notAfter,
      });

      expect(expiresAt).toBeGreaterThan(nowSeconds);
      expect(expiresAt).toBeLessThanOrEqual(nowSeconds + 2);
      expect(verifyGatewayJwt(token).vk_expires_at).toBe(
        Math.floor(notAfter.getTime() / 1000),
      );
    });
  });

  describe("when the token is read back", () => {
    it("round-trips every identity claim it was given", () => {
      const notAfter = new Date(Date.now() + 5 * 60 * 1000);

      const { jwt: token } = signGatewayJwt({ ...identity, notAfter });

      expect(verifyGatewayJwt(token)).toEqual({
        ...identity,
        vk_expires_at: Math.floor(notAfter.getTime() / 1000),
      });
    });
  });
});

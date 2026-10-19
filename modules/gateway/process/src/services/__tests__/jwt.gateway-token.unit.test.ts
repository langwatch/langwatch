/**
 * The gateway token's lifetime: cached and served while the control plane is
 * unreachable, so a token can outlive its key through an outage.
 * Spec: specs/ai-gateway/virtual-key-lifecycle.feature
 */
import { nowInstant } from "@langwatch/time";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";

import { GatewayJwtService, type GatewayJwtSubject } from "../../services/gateway-jwt.service.ts";

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
  const adapter = GatewayJwtService.create({ secret: SECRET });

  describe("when the key expires before the ordinary TTL", () => {
    it("ends the token at the key's expiration date", () => {
      const notAfter = nowInstant().add({ milliseconds: 5 * 60 * 1000 });
      const keyExpiresAt = Math.floor(notAfter.epochMilliseconds / 1000);

      const { jwt: token, expiresAt } = adapter.sign({ ...identity, notAfter });

      expect(expiresAt).toBe(keyExpiresAt);
      expect(expOf(token)).toBe(keyExpiresAt);
      expect(adapter.verify(token).vk_expires_at).toBe(keyExpiresAt);
    });
  });

  describe("when the key expires after the ordinary TTL", () => {
    it("keeps the fifteen minute lifetime and still carries the date", () => {
      const notAfter = nowInstant().add({ milliseconds: 24 * 60 * 60 * 1000 });
      const nowSeconds = Math.floor(Date.now() / 1000);

      const { jwt: token, expiresAt } = adapter.sign({ ...identity, notAfter });

      expect(expiresAt).toBeGreaterThanOrEqual(nowSeconds + TTL_SECONDS - 1);
      expect(expiresAt).toBeLessThanOrEqual(nowSeconds + TTL_SECONDS + 1);
      expect(adapter.verify(token).vk_expires_at).toBe(
        Math.floor(notAfter.epochMilliseconds / 1000),
      );
    });
  });

  /** @scenario "A key with no expiration date keeps the ordinary token lifetime" */
  it("mints the ordinary fifteen minute token for a key that never expires", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const notAfter of [null, undefined]) {
      const { jwt: token, expiresAt } = adapter.sign({ ...identity, notAfter });

      expect(expiresAt).toBeGreaterThanOrEqual(nowSeconds + TTL_SECONDS - 1);
      expect(expiresAt).toBeLessThanOrEqual(nowSeconds + TTL_SECONDS + 1);
      expect(expOf(token)).toBe(expiresAt);
      expect(adapter.verify(token).vk_expires_at).toBeNull();
    }
  });

  describe("when the date has already passed", () => {
    it("mints a token that is already finished rather than one with no lifetime", () => {
      const notAfter = nowInstant().add({ milliseconds: -60 * 60 * 1000 });
      const nowSeconds = Math.floor(Date.now() / 1000);

      const { jwt: token, expiresAt } = adapter.sign({ ...identity, notAfter });

      expect(expiresAt).toBeGreaterThan(nowSeconds);
      expect(expiresAt).toBeLessThanOrEqual(nowSeconds + 2);
      expect(adapter.verify(token).vk_expires_at).toBe(
        Math.floor(notAfter.epochMilliseconds / 1000),
      );
    });
  });

  describe("when the token is read back", () => {
    it("round-trips every identity claim it was given", () => {
      const notAfter = nowInstant().add({ milliseconds: 5 * 60 * 1000 });

      const { jwt: token } = adapter.sign({ ...identity, notAfter });

      expect(adapter.verify(token)).toEqual({
        ...identity,
        vk_expires_at: Math.floor(notAfter.epochMilliseconds / 1000),
      });
    });

    it("carries a license's hosted services, and an empty list as empty", () => {
      const entitled = adapter.sign({ ...identity, connect_services: ["managed_models"] });
      const entitledToNothing = adapter.sign({ ...identity, connect_services: [] });

      expect(adapter.verify(entitled.jwt).connect_services).toEqual(["managed_models"]);
      expect(adapter.verify(entitledToNothing.jwt).connect_services).toEqual([]);
    });

    it("leaves the claim out for an ordinary key", () => {
      const { jwt: token } = adapter.sign(identity);

      expect(adapter.verify(token)).not.toHaveProperty("connect_services");
    });
  });
});

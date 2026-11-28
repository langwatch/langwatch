import type {
  GatewayInternalProtocol,
  GatewayPresentedVirtualKey,
} from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { VirtualKeyCryptoService } from "../../features/virtual-key/services/virtual-key-crypto.service.ts";
import { GatewayInternalDoorService } from "../gateway-internal-door.service.ts";

const AT = Temporal.Instant.from("2026-09-01T00:00:00.000Z");

const customerKey: GatewayPresentedVirtualKey = {
  id: "vk-customer",
  organizationId: "org-1",
  name: "customer key",
  description: null,
  status: "ACTIVE",
  purpose: "USER",
  externalId: null,
  metadata: {},
  disabledAt: null,
  disabledReason: null,
  expiresAt: null,
  hashedSecret: "hashed",
  displayPrefix: "vk-lw-",
  principalUserId: null,
  traceProjectId: null,
  config: {},
  revision: 4n,
  previousHashedSecret: null,
  previousSecretValidUntil: null,
  presentedPreviousSecret: false,
  revokedAt: null,
  revokedById: null,
  createdAt: AT,
  updatedAt: AT,
  createdById: "user-1",
  lastUsedAt: null,
  routingPolicyId: null,
  routingMode: "FALLBACK_ALL",
  scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
  principalUser: null,
  routingPolicy: null,
};

describe("the internal door's resolve-key", () => {
  describe("when a call arrives with a virtual key", () => {
    /** @scenario A virtual key keeps working next to the license token */
    it("resolves it on the key's own record and never consults the license path", async () => {
      const secret = VirtualKeyCryptoService.mintSecret();
      const resolveLicenseToken = vi.fn();
      const findVirtualKeyBySecret = vi.fn(async () => customerKey);
      const signJwt = vi.fn(() => ({ jwt: "signed.jwt", expiresAt: 1 }));
      const door = GatewayInternalDoorService.create({
        protocol: createApiFixture<GatewayInternalProtocol>({
          findVirtualKeyBySecret,
          resolveLicenseToken,
          signJwt,
          touchVirtualKeyUsage: async () => undefined,
        }),
      });

      const answered = await door.answerResolveKey({
        raw: JSON.stringify({ key_presented: secret }),
        node: undefined,
      });

      expect(answered.status).toBe(200);
      expect(answered.body).toEqual({
        jwt: "signed.jwt",
        revision: "4",
        key_id: "vk-customer",
        display_prefix: "vk-lw-",
      });
      expect(findVirtualKeyBySecret).toHaveBeenCalledWith(secret);
      expect(signJwt).toHaveBeenCalledWith(
        expect.not.objectContaining({ connect_services: expect.anything() }),
      );
      expect(resolveLicenseToken).not.toHaveBeenCalled();
    });
  });

  describe("when the key is inside a rotation grace", () => {
    /** @scenario A token minted inside a rotation grace ends with the grace */
    it("ends the old secret at the grace end and keeps the key's own expiry", async () => {
      const graceEnd = Temporal.Now.instant().add({ seconds: 40 });
      const keyExpiresAt = Temporal.Now.instant().add({ hours: 1 });
      const signJwt = vi.fn(() => ({ jwt: "signed.jwt", expiresAt: 1 }));
      const door = GatewayInternalDoorService.create({
        protocol: createApiFixture<GatewayInternalProtocol>({
          findVirtualKeyBySecret: vi.fn(async () => ({
            ...customerKey,
            expiresAt: keyExpiresAt,
            previousHashedSecret: "old-hash",
            previousSecretValidUntil: graceEnd,
            presentedPreviousSecret: true,
          })),
          resolveLicenseToken: vi.fn(),
          signJwt,
          touchVirtualKeyUsage: async () => undefined,
        }),
      });

      await door.answerResolveKey({
        raw: JSON.stringify({ key_presented: VirtualKeyCryptoService.mintSecret() }),
        node: undefined,
      });

      expect(signJwt).toHaveBeenCalledWith(
        expect.objectContaining({ notAfter: keyExpiresAt, secretNotAfter: graceEnd }),
      );
    });

    /** @scenario The current secret keeps its own expiry during a rotation grace */
    it("keeps the current secret's token at its normal expiry", async () => {
      const signJwt = vi.fn(() => ({ jwt: "signed.jwt", expiresAt: 1 }));
      const door = GatewayInternalDoorService.create({
        protocol: createApiFixture<GatewayInternalProtocol>({
          findVirtualKeyBySecret: vi.fn(async () => ({
            ...customerKey,
            previousHashedSecret: "old-hash",
            previousSecretValidUntil: Temporal.Now.instant().add({ seconds: 40 }),
            presentedPreviousSecret: false,
          })),
          resolveLicenseToken: vi.fn(),
          signJwt,
          touchVirtualKeyUsage: async () => undefined,
        }),
      });

      await door.answerResolveKey({
        raw: JSON.stringify({ key_presented: VirtualKeyCryptoService.mintSecret() }),
        node: undefined,
      });

      expect(signJwt).toHaveBeenCalledWith(expect.objectContaining({ notAfter: null }));
      expect(signJwt).toHaveBeenCalledWith(
        expect.not.objectContaining({ secretNotAfter: expect.anything() }),
      );
    });

    it("ignores a grace that already ended", async () => {
      const signJwt = vi.fn(() => ({ jwt: "signed.jwt", expiresAt: 1 }));
      const door = GatewayInternalDoorService.create({
        protocol: createApiFixture<GatewayInternalProtocol>({
          findVirtualKeyBySecret: vi.fn(async () => ({
            ...customerKey,
            previousSecretValidUntil: Temporal.Now.instant().subtract({ seconds: 40 }),
            presentedPreviousSecret: true,
          })),
          resolveLicenseToken: vi.fn(),
          signJwt,
          touchVirtualKeyUsage: async () => undefined,
        }),
      });

      await door.answerResolveKey({
        raw: JSON.stringify({ key_presented: VirtualKeyCryptoService.mintSecret() }),
        node: undefined,
      });

      expect(signJwt).toHaveBeenCalledWith(
        expect.not.objectContaining({ secretNotAfter: expect.anything() }),
      );
    });
  });
});

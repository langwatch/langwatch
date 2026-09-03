/**
 * Turning a bearer token into a caller.
 *
 * This runs on every authenticated request, so its refusals are the product:
 * a revoked key, an expired one, and a wrong secret all have to come back as
 * "no", and the hashed secret has to stay on the server side of the boundary.
 *
 * Resolution is not authorization. It establishes who is calling and against
 * which project; whether that caller may do the thing is the ceiling check in
 * the auth middleware, which asks per permission at the project's scope. That
 * is why naming a project the key is not bound to still resolves — the
 * organization is the boundary enforced here, and the ceiling does the rest.
 */

import { describe, expect, it } from "vitest";
import { ApiKeyNotFoundError, LANGY_SESSION_API_KEY_NAME } from "@langwatch/api-key-contract";
import { ApiKeyTokenResolutionService } from "../api-key-token-resolution.service";

const CURRENT_TOKEN = `sk-lw-${"a".repeat(16)}_${"b".repeat(48)}`;
const LEGACY_TOKEN = "sk-lw-legacy-project-key";

const project = (over: Record<string, unknown> = {}) => ({
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
  ...over,
});

const storedKey = (over: Record<string, unknown> = {}) => ({
  id: "key-1",
  name: "a key",
  hashedSecret: "hashed",
  revokedAt: null,
  expiresAt: null,
  userId: "user-1",
  organizationId: "organization-1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  roleBindings: [{ scopeType: "PROJECT", scopeId: "project-1" }],
  ...over,
});

type Fakes = {
  row?: Record<string, unknown> | null;
  verify?: "match" | "match_legacy" | "no_match";
  legacyProjectId?: string | null;
  identity?: Record<string, unknown> | null;
  upgradeFails?: boolean;
};

function serviceWith(fakes: Fakes = {}) {
  const calls: string[] = [];
  const service = ApiKeyTokenResolutionService.create({
    repository: {
      tryFindByLookupId: async () => (fakes.row === undefined ? storedKey() : fakes.row),
      upgradeHash: async () => {
        calls.push("upgradeHash");
        if (fakes.upgradeFails) throw new Error("write failed");
      },
      tryFindLegacyProjectId: async () => fakes.legacyProjectId ?? null,
      rotateLegacyProjectKey: async () => "rotated",
    },
    tokens: {
      trySplit: (token: string) =>
        token.startsWith("sk-lw-") ? { lookupId: "lookup", secret: "secret" } : null,
      verify: () => fakes.verify ?? "match",
      hash: () => "rehashed",
      generateLegacyProjectKey: () => "generated",
    },
    projects: {
      tryGetIdentity: async () => (fakes.identity === undefined ? project() : fakes.identity),
    },
    legacyGrants: { mint: () => calls.push("mint") },
  } as never);

  return { calls, service };
}

describe("ApiKeyTokenResolutionService", () => {
  describe("tryVerify", () => {
    describe("given a revoked key", () => {
      it("refuses it", async () => {
        const { service } = serviceWith({ row: storedKey({ revokedAt: new Date() }) });

        await expect(service.tryVerify({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given an expired key", () => {
      it("refuses it", async () => {
        const { service } = serviceWith({
          row: storedKey({ expiresAt: new Date(Date.now() - 1000) }),
        });

        await expect(service.tryVerify({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given a key that expires in the future", () => {
      it("accepts it", async () => {
        const { service } = serviceWith({
          row: storedKey({ expiresAt: new Date(Date.now() + 60_000) }),
        });

        await expect(service.tryVerify({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          id: "key-1",
        });
      });
    });

    describe("given a secret that does not match the stored hash", () => {
      it("refuses it", async () => {
        const { service } = serviceWith({ verify: "no_match" });

        await expect(service.tryVerify({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given a token that is not shaped like one of ours", () => {
      it("refuses it without reaching storage", async () => {
        const { service } = serviceWith({});

        await expect(service.tryVerify({ token: "not-a-token" })).resolves.toBeNull();
      });
    });

    describe("given a key nothing is stored for", () => {
      it("refuses it", async () => {
        const { service } = serviceWith({ row: null });

        await expect(service.tryVerify({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given a valid key", () => {
      it("never hands back the stored secret", async () => {
        const { service } = serviceWith({});

        const verified = await service.tryVerify({ token: CURRENT_TOKEN });

        expect(verified).not.toBeNull();
        expect(verified).not.toHaveProperty("hashedSecret");
      });
    });

    describe("given a key still on the old hash", () => {
      it("re-hashes it while still letting the caller in", async () => {
        const { service, calls } = serviceWith({ verify: "match_legacy" });

        await expect(service.tryVerify({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          id: "key-1",
        });
        expect(calls).toContain("upgradeHash");
      });

      it("lets the caller in even when the re-hash cannot be written", async () => {
        // The upgrade is opportunistic. A failed write is a slower login next
        // time, not a locked-out customer.
        const { service } = serviceWith({ verify: "match_legacy", upgradeFails: true });

        await expect(service.tryVerify({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          id: "key-1",
        });
      });
    });
  });

  describe("tryResolveToken", () => {
    describe("given a key whose organization does not own the named project", () => {
      it("refuses it, rather than resolving across the tenant boundary", async () => {
        const { service } = serviceWith({
          identity: project({ organizationId: "other-organization" }),
        });

        await expect(
          service.tryResolveToken({ token: CURRENT_TOKEN, projectId: "project-1" }),
        ).resolves.toBeNull();
      });
    });

    describe("given a key bound to exactly one project and no project named", () => {
      it("resolves that project", async () => {
        const { service } = serviceWith({});

        await expect(service.tryResolveToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          type: "apiKey",
          apiKeyId: "key-1",
          project: { id: "project-1" },
        });
      });
    });

    describe("given a key bound to two projects and no project named", () => {
      it("refuses, rather than picking one of them", async () => {
        const { service } = serviceWith({
          row: storedKey({
            roleBindings: [
              { scopeType: "PROJECT", scopeId: "project-1" },
              { scopeType: "PROJECT", scopeId: "project-2" },
            ],
          }),
        });

        await expect(service.tryResolveToken({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given a key bound to no project and no project named", () => {
      it("refuses", async () => {
        const { service } = serviceWith({
          row: storedKey({
            roleBindings: [{ scopeType: "ORGANIZATION", scopeId: "organization-1" }],
          }),
        });

        await expect(service.tryResolveToken({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given the key that carries a Langy session", () => {
      it("marks the resolution, so the session can be told apart from a normal key", async () => {
        const { service } = serviceWith({
          row: storedKey({ name: LANGY_SESSION_API_KEY_NAME }),
        });

        await expect(service.tryResolveToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          isLangySessionKey: true,
        });
      });

      it("leaves an ordinary key unmarked", async () => {
        const { service } = serviceWith({ row: storedKey({ name: "a key" }) });

        await expect(service.tryResolveToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          isLangySessionKey: false,
        });
      });
    });

    describe("given a legacy project key", () => {
      it("resolves it to its project", async () => {
        const { service } = serviceWith({ legacyProjectId: "project-1" });

        await expect(service.tryResolveToken({ token: LEGACY_TOKEN })).resolves.toMatchObject({
          type: "legacyProjectKey",
          project: { id: "project-1" },
        });
      });

      it("refuses one whose project no longer exists", async () => {
        const { service } = serviceWith({ legacyProjectId: "project-1", identity: null });

        await expect(service.tryResolveToken({ token: LEGACY_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given a current-shaped token that verifies as nothing", () => {
      it("falls back to reading it as a legacy project key", async () => {
        const { service } = serviceWith({ verify: "no_match", legacyProjectId: "project-1" });

        await expect(service.tryResolveToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          type: "legacyProjectKey",
        });
      });
    });
  });

  describe("resolveOrganizationToken", () => {
    describe("given a valid organization-usable key", () => {
      it("resolves it", async () => {
        const { service } = serviceWith({});

        await expect(service.resolveOrganizationToken({ token: CURRENT_TOKEN })).resolves.toEqual({
          ok: true,
          resolved: {
            type: "apiKey-org",
            apiKeyId: "key-1",
            userId: "user-1",
            organizationId: "organization-1",
          },
        });
      });
    });

    describe("given a project key where an organization key was required", () => {
      it("says the credential is of the wrong class, not that it is unusable", async () => {
        // The two refusals read differently to a customer: one says "use your
        // organization key", the other says "this token is not ours".
        const { service } = serviceWith({ verify: "no_match", legacyProjectId: "project-1" });

        await expect(service.resolveOrganizationToken({ token: CURRENT_TOKEN })).resolves.toEqual({
          ok: false,
          reason: "wrong_credential_class",
        });
      });
    });

    describe("given a token that is nothing we issued", () => {
      it("says it is unusable", async () => {
        const { service } = serviceWith({ row: null, legacyProjectId: null });

        await expect(service.resolveOrganizationToken({ token: CURRENT_TOKEN })).resolves.toEqual({
          ok: false,
          reason: "unusable_credential",
        });
      });
    });
  });

  describe("regenerateLegacyProjectKey", () => {
    describe("given a project that has no legacy key to rotate", () => {
      it("refuses, rather than reporting a token it never stored", async () => {
        const service = ApiKeyTokenResolutionService.create({
          repository: { rotateLegacyProjectKey: async () => null },
          tokens: { generateLegacyProjectKey: () => "generated" },
        } as never);

        await expect(
          service.regenerateLegacyProjectKey({ projectId: "project-1" }),
        ).rejects.toBeInstanceOf(ApiKeyNotFoundError);
      });
    });

    describe("given a project that has one", () => {
      it("hands back the token it rotated in", async () => {
        const { service } = serviceWith({});

        await expect(service.regenerateLegacyProjectKey({ projectId: "project-1" })).resolves.toBe(
          "generated",
        );
      });
    });
  });
});

/**
 * Turning a bearer token into a caller. This runs on every authenticated request, so its
 * refusals are the product: a revoked key, an expired one, and a wrong secret all have to come
 * back as "no", and the hashed secret has to stay on the server side of the boundary.
 */

import { LANGY_SESSION_API_KEY_NAME, WORKFLOW_RUN_API_KEY_NAME } from "@langwatch/api-key-contract";
import { fromDate, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { ApiKeyTokenResolutionService } from "../api-key-token-resolution.service.ts";

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
  grants: [{ scopeType: "PROJECT", scopeId: "project-1" }],
  ...over,
});

type Fakes = {
  row?: Record<string, unknown> | null;
  verify?: "match" | "match_legacy" | "no_match";
  legacyProjectId?: string | null;
  identity?: Record<string, unknown> | null;
  upgradeFails?: boolean;
  parentLiveness?: { revokedAt: Instant | null; expiresAt: Instant | null } | null;
};

function serviceWith(fakes: Fakes = {}) {
  const calls: string[] = [];
  const row = fakes.row === undefined ? storedKey() : fakes.row;
  const service = ApiKeyTokenResolutionService.create({
    // The key's grants live on authz's grants head, not on its row.
    authz: {
      listApiKeyBindings: async () =>
        Array.isArray(row?.grants)
          ? row.grants.map((binding: Record<string, unknown>) => ({
              ...binding,
              id: "grant-1",
              apiKeyId: row.id,
              role: "VIEWER",
              customRoleId: null,
            }))
          : [],
    },
    repository: {
      findByLookupId: async () => row && { ...row, grants: undefined },
      upgradeHash: async () => {
        calls.push("upgradeHash");
        if (fakes.upgradeFails) throw new Error("write failed");
      },
      findLivenessById: async () =>
        fakes.parentLiveness === undefined
          ? { revokedAt: null, expiresAt: null }
          : fakes.parentLiveness,
    },
    tokens: {
      findTokenParts: (token: string) =>
        token.startsWith("sk-lw-") ? { lookupId: "lookup", secret: "secret" } : null,
      verify: () => fakes.verify ?? "match",
      hash: () => "rehashed",
    },
    projects: {
      findIdentity: async () => (fakes.identity === undefined ? project() : fakes.identity),
      findIdByLegacyApiKey: async () => fakes.legacyProjectId ?? null,
    },
    legacyGrants: { mint: () => calls.push("mint") },
    answers: MemoryApiKeyAnswerCacheRepository.create(),
  } as never);

  return { calls, service };
}

describe("ApiKeyTokenResolutionService", () => {
  describe("findVerifiedToken()", () => {
    describe("given a revoked key", () => {
      it("refuses it", async () => {
        const { service } = serviceWith({ row: storedKey({ revokedAt: new Date() }) });

        await expect(service.findVerifiedToken({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given an expired key", () => {
      /** @scenario "A revoked or expired key cannot authenticate" */
      it("refuses it", async () => {
        const { service } = serviceWith({
          row: storedKey({ expiresAt: new Date(Date.now() - 1000) }),
        });

        await expect(service.findVerifiedToken({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given a key that expires in the future", () => {
      it("accepts it", async () => {
        const { service } = serviceWith({
          row: storedKey({ expiresAt: new Date(Date.now() + 60_000) }),
        });

        await expect(service.findVerifiedToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          id: "key-1",
        });
      });
    });

    describe("given a secret that does not match the stored hash", () => {
      it("refuses it", async () => {
        const { service } = serviceWith({ verify: "no_match" });

        await expect(service.findVerifiedToken({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given a token that is not shaped like one of ours", () => {
      it("refuses it without reaching storage", async () => {
        const { service } = serviceWith({});

        await expect(service.findVerifiedToken({ token: "not-a-token" })).resolves.toBeNull();
      });
    });

    describe("given a key nothing is stored for", () => {
      it("refuses it", async () => {
        const { service } = serviceWith({ row: null });

        await expect(service.findVerifiedToken({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given a valid key", () => {
      it("never hands back the stored secret", async () => {
        const { service } = serviceWith({});

        const verified = await service.findVerifiedToken({ token: CURRENT_TOKEN });

        expect(verified).not.toBeNull();
        expect(verified).not.toHaveProperty("hashedSecret");
      });
    });

    describe("given a key minted under a CLI login session", () => {
      /** @scenario "A key minted as its session is being retired does not outlive it" */
      /** @scenario "A key whose session is gone does not authenticate" */
      it("refuses it once the parent login key is revoked", async () => {
        const { service } = serviceWith({
          row: storedKey({ parentApiKeyId: "login-key-1" }),
          parentLiveness: { revokedAt: fromDate(new Date()), expiresAt: null },
        });

        await expect(service.findVerifiedToken({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });

      /** @scenario "A key minted as its session is being retired does not outlive it" */
      /** @scenario "A key whose session is gone does not authenticate" */
      it("refuses it once the parent login key's session has expired", async () => {
        const { service } = serviceWith({
          row: storedKey({ parentApiKeyId: "login-key-1" }),
          parentLiveness: { revokedAt: null, expiresAt: fromDate(new Date(Date.now() - 1000)) },
        });

        await expect(service.findVerifiedToken({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });

      /** @scenario "A key whose session is gone does not authenticate" */
      it("refuses it once the parent login key row is gone", async () => {
        const { service } = serviceWith({
          row: storedKey({ parentApiKeyId: "login-key-1" }),
          parentLiveness: null,
        });

        await expect(service.findVerifiedToken({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });

      it("accepts it while the parent login key is still live", async () => {
        const { service } = serviceWith({
          row: storedKey({ parentApiKeyId: "login-key-1" }),
          parentLiveness: { revokedAt: null, expiresAt: fromDate(new Date(Date.now() + 60_000)) },
        });

        await expect(service.findVerifiedToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          id: "key-1",
        });
      });
    });

    describe("given a key still on the old hash", () => {
      it("re-hashes it while still letting the caller in", async () => {
        const { service, calls } = serviceWith({ verify: "match_legacy" });

        await expect(service.findVerifiedToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          id: "key-1",
        });
        expect(calls).toContain("upgradeHash");
      });

      it("lets the caller in even when the re-hash cannot be written", async () => {
        // The upgrade is opportunistic. A failed write is a slower login next
        // time, not a locked-out customer.
        const { service } = serviceWith({ verify: "match_legacy", upgradeFails: true });

        await expect(service.findVerifiedToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          id: "key-1",
        });
      });
    });
  });

  describe("findResolvedToken()", () => {
    describe("given a key whose organization does not own the named project", () => {
      it("refuses it, rather than resolving across the tenant boundary", async () => {
        const { service } = serviceWith({
          identity: project({ organizationId: "other-organization" }),
        });

        await expect(
          service.findResolvedToken({ token: CURRENT_TOKEN, projectId: "project-1" }),
        ).resolves.toBeNull();
      });
    });

    describe("given a key bound to one project that names a sibling project", () => {
      /** @scenario "A scoped key cannot be re-pointed at a project its grants do not reach" */
      it("refuses it, rather than re-pointing the key at a project it does not cover", async () => {
        const { service } = serviceWith({
          identity: project({ id: "project-2", teamId: "team-2" }),
        });

        await expect(
          service.findResolvedToken({ token: CURRENT_TOKEN, projectId: "project-2" }),
        ).resolves.toBeNull();
      });
    });

    describe("given an organization-scoped key that names a project in it", () => {
      /** @scenario "An organization or team key still selects a project it covers" */
      it("resolves that project", async () => {
        const { service } = serviceWith({
          row: storedKey({
            grants: [{ scopeType: "ORGANIZATION", scopeId: "organization-1" }],
          }),
          identity: project({ id: "project-2", teamId: "team-2" }),
        });

        await expect(
          service.findResolvedToken({ token: CURRENT_TOKEN, projectId: "project-2" }),
        ).resolves.toMatchObject({ type: "apiKey", project: { id: "project-2" } });
      });
    });

    describe("given a team-scoped key that names a project on that team", () => {
      /** @scenario "An organization or team key still selects a project it covers" */
      it("resolves that project", async () => {
        const { service } = serviceWith({
          row: storedKey({ grants: [{ scopeType: "TEAM", scopeId: "team-1" }] }),
          identity: project({ id: "project-2", teamId: "team-1" }),
        });

        await expect(
          service.findResolvedToken({ token: CURRENT_TOKEN, projectId: "project-2" }),
        ).resolves.toMatchObject({ type: "apiKey", project: { id: "project-2" } });
      });
    });

    describe("given a key bound to exactly one project and no project named", () => {
      it("resolves that project", async () => {
        const { service } = serviceWith({});

        await expect(service.findResolvedToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
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
            grants: [
              { scopeType: "PROJECT", scopeId: "project-1" },
              { scopeType: "PROJECT", scopeId: "project-2" },
            ],
          }),
        });

        await expect(service.findResolvedToken({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given a key bound to no project and no project named", () => {
      it("refuses", async () => {
        const { service } = serviceWith({
          row: storedKey({
            grants: [{ scopeType: "ORGANIZATION", scopeId: "organization-1" }],
          }),
        });

        await expect(service.findResolvedToken({ token: CURRENT_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given the key that carries a Langy session", () => {
      it("marks the resolution, so the session can be told apart from a normal key", async () => {
        const { service } = serviceWith({
          row: storedKey({ name: LANGY_SESSION_API_KEY_NAME }),
        });

        await expect(service.findResolvedToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          isLangySessionKey: true,
        });
      });

      it("leaves an ordinary key unmarked", async () => {
        const { service } = serviceWith({ row: storedKey({ name: "a key" }) });

        await expect(service.findResolvedToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          isLangySessionKey: false,
        });
      });
    });

    describe("given ownerless run keys", () => {
      /** @scenario "Only a run key nobody started acts as the system" */
      it("marks only the one with no parent key as an unattended run", async () => {
        const runKey = { name: WORKFLOW_RUN_API_KEY_NAME, isSystemManaged: true, userId: null };
        const scheduled = serviceWith({ row: storedKey({ ...runKey, parentApiKeyId: null }) });
        const keyStarted = serviceWith({
          row: storedKey({ ...runKey, parentApiKeyId: "service-key-1" }),
        });

        await expect(
          scheduled.service.findResolvedToken({ token: CURRENT_TOKEN }),
        ).resolves.toMatchObject({ isUnattendedRunKey: true, userId: null });
        await expect(
          keyStarted.service.findResolvedToken({ token: CURRENT_TOKEN }),
        ).resolves.toMatchObject({ isUnattendedRunKey: false, userId: null });
      });
    });

    describe("given a legacy project key", () => {
      it("resolves it to its project", async () => {
        const { service } = serviceWith({ legacyProjectId: "project-1" });

        await expect(service.findResolvedToken({ token: LEGACY_TOKEN })).resolves.toMatchObject({
          type: "legacyProjectKey",
          project: { id: "project-1" },
        });
      });

      it("resolves a pre-2025 `eyJ` value as an opaque legacy key, never as a JWT", async () => {
        const { service } = serviceWith({ legacyProjectId: "project-1" });
        const token = "eyJhbGciOiJIUzI1NiJ9.eyJwcm9qZWN0SWQiOiJwcm9qZWN0LTEifQ.c2lnbmF0dXJl";

        await expect(service.findResolvedToken({ token })).resolves.toMatchObject({
          type: "legacyProjectKey",
          project: { id: "project-1" },
        });
      });

      it("refuses one whose project no longer exists", async () => {
        const { service } = serviceWith({ legacyProjectId: "project-1", identity: null });

        await expect(service.findResolvedToken({ token: LEGACY_TOKEN })).resolves.toBeNull();
      });
    });

    describe("given a current-shaped token that verifies as nothing", () => {
      it("falls back to reading it as a legacy project key", async () => {
        const { service } = serviceWith({ verify: "no_match", legacyProjectId: "project-1" });

        await expect(service.findResolvedToken({ token: CURRENT_TOKEN })).resolves.toMatchObject({
          type: "legacyProjectKey",
        });
      });
    });
  });

  describe("resolveOrganizationToken()", () => {
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
});

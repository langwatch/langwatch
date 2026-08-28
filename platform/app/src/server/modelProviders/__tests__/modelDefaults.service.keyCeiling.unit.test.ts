/**
 * @vitest-environment node
 *
 * Default-model writes are authorized per target scope, so a project admin
 * cannot push a project default up to the organization. That gate resolved
 * the OWNER's permissions and nothing else, which is half the contract every
 * other API-key surface keeps: effective(key) = grants(key) ∩ grants(owner).
 *
 * The consequence was a read-only key belonging to an admin writing
 * organization-wide model defaults — the admin held `organization:manage`,
 * and nothing asked what the key held. These pin the key's half, at the same
 * scope and on the same permission the owner is held to.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasApiKeyPermission, getApiKeyProjectDecision, probe } = vi.hoisted(
  () => ({
    hasApiKeyPermission: vi.fn(),
    getApiKeyProjectDecision: vi.fn(),
    probe: vi.fn(),
  }),
);

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    permissions: { hasApiKeyPermission, getApiKeyProjectDecision },
  }),
}));
vi.mock("~/server/app-layer/permissions/imperative", () => ({
  probeOrganizationPermission: probe,
  probeTeamPermission: probe,
  probeProjectPermission: probe,
}));

import { ModelDefaultScopeForbiddenError } from "../errors";
import { assertCanWriteScope } from "../modelDefaults.service";

const ORG = "org-1";
const ctxFor = (credential: unknown) =>
  ({
    prisma: {} as never,
    session: { user: { id: "user-1" } },
    credential,
  }) as never;

const KEY = { apiKeyId: "key-1", userId: "user-1", organizationId: ORG };

describe("assertCanWriteScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The OWNER always holds the permission in these — the key is the subject.
    probe.mockResolvedValue(true);
  });

  describe("given an API key whose owner is an admin", () => {
    describe("when the key does not hold the permission at organization scope", () => {
      it("refuses the write its owner alone would have been allowed", async () => {
        hasApiKeyPermission.mockResolvedValue(false);

        await expect(
          assertCanWriteScope(ctxFor(KEY), "ORGANIZATION", ORG),
        ).rejects.toBeInstanceOf(ModelDefaultScopeForbiddenError);
      });
    });

    describe("when the key holds it", () => {
      it("allows the write", async () => {
        hasApiKeyPermission.mockResolvedValue(true);

        await expect(
          assertCanWriteScope(ctxFor(KEY), "ORGANIZATION", ORG),
        ).resolves.toBeUndefined();
      });
    });

    describe("when the scope is a team", () => {
      it("demands team:manage of the key, not just the owner", async () => {
        hasApiKeyPermission.mockResolvedValue(false);

        await expect(
          assertCanWriteScope(ctxFor(KEY), "TEAM", "team-1"),
        ).rejects.toBeInstanceOf(ModelDefaultScopeForbiddenError);
        expect(hasApiKeyPermission).toHaveBeenCalledWith(
          expect.objectContaining({ permission: "team:manage" }),
        );
      });
    });

    describe("when the scope is a project", () => {
      it("resolves the project's tier chain rather than assembling a scope", async () => {
        getApiKeyProjectDecision.mockResolvedValue({ outcome: "denied" });

        await expect(
          assertCanWriteScope(ctxFor(KEY), "PROJECT", "project-1"),
        ).rejects.toBeInstanceOf(ModelDefaultScopeForbiddenError);
        expect(getApiKeyProjectDecision).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "project-1",
            permission: "project:update",
          }),
        );
      });
    });
  });

  describe("given a browser session", () => {
    it("is unaffected — it has no second half to cap", async () => {
      await expect(
        assertCanWriteScope(ctxFor(null), "ORGANIZATION", ORG),
      ).resolves.toBeUndefined();
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });
  });

  describe("given a legacy project key", () => {
    it("keeps the full project access it has everywhere else", async () => {
      // It sets no apiKeyId, so the route resolves no credential for it.
      await expect(
        assertCanWriteScope(ctxFor(undefined), "PROJECT", "project-1"),
      ).resolves.toBeUndefined();
      expect(getApiKeyProjectDecision).not.toHaveBeenCalled();
    });
  });
});

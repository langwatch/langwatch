/**
 * @vitest-environment node
 *
 * What a KEY may see of a project's spend on the governed-SQL door.
 *
 * The door used to answer `canSeeCosts: true` for every key alike, on the
 * reasoning that a project key carries full project access — true of the
 * legacy credential class, and false of every key minted since, which carries
 * exactly the grants it was given. So the question is asked of the credential,
 * through the same check the route chain enforces a declared permission with.
 *
 * @see specs/api-keys/scope-based-permissions.feature
 */
import type { AuthzService } from "@langwatch/authz-contract";
import { resolveDataPrivacy } from "@langwatch/data-privacy-contract";
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import { describe, expect, it, vi } from "vitest";

import { ApiAnalyticsProtections } from "../analytics.composition.ts";

const SCOPED_KEY: RestCredentialPrincipal = {
  kind: "apiKey",
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "organization-1",
  projectId: "project-1",
  teamId: "team-1",
};

const LEGACY_KEY: RestCredentialPrincipal = { kind: "legacyProjectKey" };

/** The project's default privacy policy, so only the cost answer varies. */
function openPolicy() {
  return resolveDataPrivacy({
    rows: [],
    facts: {
      organizationId: "organization-1",
      teamId: "team-1",
      projectId: "project-1",
      departmentId: null,
      isPersonal: false,
    },
  });
}

function protectionsWith(granted: boolean) {
  const hasApiKeyPermission = vi.fn(async () => granted);
  const protections = ApiAnalyticsProtections.create({
    authz: { hasApiKeyPermission } as unknown as AuthzService,
    dataPrivacy: { getResolvedForProject: async () => openPolicy() },
  });
  return { protections, hasApiKeyPermission };
}

describe("given a key reading the governed-SQL surface", () => {
  describe("when the key carries no cost grant", () => {
    /** @scenario "A key without the cost grant reads the query surface with costs redacted" */
    it("hides costs from it", async () => {
      const { protections, hasApiKeyPermission } = protectionsWith(false);

      const resolved = await protections.resolveForApiKey({
        projectId: "project-1",
        credential: SCOPED_KEY,
      });

      expect(resolved.canSeeCosts).toBe(false);
      expect(hasApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyId: "key-1",
          userId: "user-1",
          permission: "cost:view",
          scope: { type: "project", id: "project-1", teamId: "team-1" },
        }),
      );
    });
  });

  describe("when the key carries the cost grant", () => {
    /** @scenario "A key carrying the cost grant reads the query surface with costs" */
    it("shows costs to it", async () => {
      const { protections } = protectionsWith(true);

      const resolved = await protections.resolveForApiKey({
        projectId: "project-1",
        credential: SCOPED_KEY,
      });

      expect(resolved.canSeeCosts).toBe(true);
    });
  });

  describe("when the credential is a legacy project key", () => {
    /** @scenario "A legacy project key still reads costs without a grant lookup" */
    it("shows costs without asking for a grant it could not carry", async () => {
      const { protections, hasApiKeyPermission } = protectionsWith(false);

      const resolved = await protections.resolveForApiKey({
        projectId: "project-1",
        credential: LEGACY_KEY,
      });

      expect(resolved.canSeeCosts).toBe(true);
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });
  });
});

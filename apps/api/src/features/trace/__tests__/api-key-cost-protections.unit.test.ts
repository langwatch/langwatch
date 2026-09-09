/**
 * @vitest-environment node
 *
 * What a KEY may see of a project's spend on the trace read doors.
 *
 * The stack resolved the anonymous protections and then forced costs back on
 * for every key alike, which handed a key holding no `cost:view` exactly the
 * spend the in-app surfaces hide from its holder. Cost is now the credential's
 * own grant; the legacy project key, which predates fine-grained permissions,
 * is the one class still answered without a lookup.
 *
 * @see specs/api-keys/scope-based-permissions.feature
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import { resolveDataPrivacy } from "@langwatch/data-privacy-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { composeApiTraceReadStack } from "../../../app/api-trace-read-stack.composition.ts";
import { testDataPrivacyApi } from "./support/test-data-privacy.service.ts";
import { composeApiPlanProvider } from "../../../app/api-usage.composition.ts";

const SCOPED_KEY: RestCredentialPrincipal = {
  kind: "apiKey",
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "organization-1",
  projectId: "project-1",
  teamId: "team-1",
};

const LEGACY_KEY: RestCredentialPrincipal = { kind: "legacyProjectKey" };

/** A collaborator this read never reaches; called, it must fail the test loudly. */
function unreachable<T>(name: string): T {
  return new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(`${name} must not be reached by an API-key protections read`);
      },
    },
  ) as T;
}

function readStackWith(granted: boolean) {
  const hasApiKeyPermission = vi.fn(async () => granted);
  const reads = composeApiTraceReadStack({
    prisma: unreachable<PrismaClient>("prisma"),
    resolveClickHouseClient: null,
    defaultRetentionDays: 90,
    authz: {
      hasApiKeyPermission,
      hasPermission: async () => false,
    } as unknown as AuthzService,
    projects: {
      tryGetWithTeam: async () => ({ id: "project-1", team: { organizationId: "organization-1" } }),
    } as unknown as ProjectApi,
    dataPrivacy: testDataPrivacyApi(
      resolveDataPrivacy({
        rows: [],
        facts: {
          organizationId: "organization-1",
          teamId: "team-1",
          projectId: "project-1",
          departmentId: null,
          isPersonal: false,
        },
      }),
    ),
    plans: composeApiPlanProvider({ isSaas: false }),
    dataRetention: unreachable("dataRetention"),
    topics: unreachable("topics"),
    modelProviders: undefined,
    executionProxyBaseUrl: "http://127.0.0.1:5561",
    processName: "langwatch-api-test",
  });
  return { reads, hasApiKeyPermission };
}

describe("given a key reading traces over REST", () => {
  describe("when the key carries no cost grant", () => {
    /** @scenario "A key without the cost grant reads traces with costs redacted" */
    it("hides costs from it", async () => {
      const { reads, hasApiKeyPermission } = readStackWith(false);

      const protections = await reads.getApiKeyProtections({
        projectId: "project-1",
        credential: SCOPED_KEY,
      });

      expect(protections.canSeeCosts).toBe(false);
      expect(hasApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyId: "key-1",
          permission: "cost:view",
          scope: { type: "project", id: "project-1", teamId: "team-1" },
        }),
      );
    });
  });

  describe("when the key carries the cost grant", () => {
    /** @scenario "A key carrying the cost grant reads the query surface with costs" */
    it("shows costs to it", async () => {
      const { reads } = readStackWith(true);

      const protections = await reads.getApiKeyProtections({
        projectId: "project-1",
        credential: SCOPED_KEY,
      });

      expect(protections.canSeeCosts).toBe(true);
    });
  });

  describe("when the credential is a legacy project key", () => {
    /** @scenario "A legacy project key still reads costs without a grant lookup" */
    it("shows costs without asking for a grant it could not carry", async () => {
      const { reads, hasApiKeyPermission } = readStackWith(false);

      const protections = await reads.getApiKeyProtections({
        projectId: "project-1",
        credential: LEGACY_KEY,
      });

      expect(protections.canSeeCosts).toBe(true);
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });
  });
});

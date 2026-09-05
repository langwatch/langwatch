/**
 * @see specs/security/api-endpoint-authorization.feature
 * The secured families over the process's real credential chain: the ceiling holds, and a
 * key for one organization cannot resolve another organization's project.
 */
import type { AnalyticsApp } from "@langwatch/analytics-server";
import type { ExperimentApp } from "@langwatch/experiment-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import {
  REST_AUTH_ORGANIZATION,
  REST_AUTH_PROJECT,
  RestAuthWorld,
  type RestAuthKey,
} from "./support/rest-auth.world";
import { mountRestFamily, type MountedRestFamily } from "./support/rest-family.harness";

/** The other tenant, seeded so a cross-organization key has somewhere real to come from. */
const OTHER_PROJECT = {
  id: "project-beta",
  name: "Beta",
  slug: "beta",
  teamId: "team-beta",
  organizationId: "organization-beta",
  isPersonal: false,
  ownerUserId: null,
} as const;

const ADMIN_KEY = "sk-lw-alpha-admin";
const READ_ONLY_KEY = "sk-lw-alpha-traces-view";
const WORKFLOWS_ONLY_KEY = "sk-lw-alpha-workflows-view";
const EXPERIMENTS_ONLY_KEY = "sk-lw-alpha-experiments-view";
const OTHER_ORGANIZATION_KEY = "sk-lw-beta-admin";

const KEYS: readonly RestAuthKey[] = [
  { token: ADMIN_KEY, projectId: REST_AUTH_PROJECT.id, apiKeyId: "key-admin" },
  {
    token: READ_ONLY_KEY,
    projectId: REST_AUTH_PROJECT.id,
    apiKeyId: "key-read-only",
    grants: ["traces:view"],
  },
  {
    token: WORKFLOWS_ONLY_KEY,
    projectId: REST_AUTH_PROJECT.id,
    apiKeyId: "key-workflows",
    grants: ["workflows:view"],
  },
  {
    token: EXPERIMENTS_ONLY_KEY,
    projectId: REST_AUTH_PROJECT.id,
    apiKeyId: "key-experiments",
    grants: ["experiments:view"],
  },
  {
    token: OTHER_ORGANIZATION_KEY,
    projectId: OTHER_PROJECT.id,
    apiKeyId: "key-beta-admin",
    userId: "user-beta",
  },
];

function bearer(token: string, projectId?: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...(projectId ? { "x-project-id": projectId } : {}),
  };
}

function mount(
  overrides: {
    modelProviders?: Partial<ModelProviderService>;
    experiments?: Partial<ExperimentApp>;
    analytics?: Partial<AnalyticsApp>;
  } = {},
): MountedRestFamily {
  const world = RestAuthWorld.create({
    projects: [REST_AUTH_PROJECT, OTHER_PROJECT],
    keys: KEYS,
    organizations: [REST_AUTH_ORGANIZATION, OTHER_PROJECT.organizationId],
  });

  const modelProviders = {
    getForProject: vi.fn(async () => []),
    getDefaultSnapshot: vi.fn(async () => ({
      projectId: REST_AUTH_PROJECT.id,
      teamId: REST_AUTH_PROJECT.teamId,
      organizationId: REST_AUTH_ORGANIZATION,
      organizationName: "Alpha",
      effective: {},
      configs: [],
    })),
    upsert: vi.fn(async () => []),
    ...overrides.modelProviders,
  } as unknown as ModelProviderService;

  return mountRestFamily({
    security: world.security(),
    packaged: {
      modelProviders: () => modelProviders,
      organizations: () =>
        ({
          getSettings: async () => ({ id: REST_AUTH_ORGANIZATION, name: "Alpha" }),
          getTeamById: async () => ({
            id: REST_AUTH_PROJECT.teamId,
            organizationId: REST_AUTH_ORGANIZATION,
          }),
        }) as unknown as OrganizationService,
      experiments: () =>
        ({
          getPage: vi.fn(async () => ({ experiments: [], totalHits: 0 })),
          withRunAggregates: vi.fn(async () => []),
          ...overrides.experiments,
        }) as unknown as ExperimentApp,
      analytics: () =>
        ({
          getTimeseries: vi.fn(async () => ({ currentPeriod: [], previousPeriod: [] })),
          ...overrides.analytics,
        }) as unknown as AnalyticsApp,
    } as never,
  });
}

describe("given a project key that lacks the route's permission", () => {
  describe("when it calls a read route declaring another resource's permission", () => {
    /** @scenario "A project API key lacking the required permission is forbidden" */
    it("forbids the model-provider listing, which requires project:view", async () => {
      const response = await mount().get("/api/model-providers", bearer(READ_ONLY_KEY));

      expect(response.status).toBe(403);
    });

    it("forbids the model-defaults snapshot, which requires project:view", async () => {
      const response = await mount().get("/api/model-defaults", bearer(READ_ONLY_KEY));

      expect(response.status).toBe(403);
    });

    it("forbids the experiment listing for a workflows-only key", async () => {
      const response = await mount().get("/api/experiments", bearer(WORKFLOWS_ONLY_KEY));

      expect(response.status).toBe(403);
    });
  });

  describe("when it holds only read permissions and calls a write route", () => {
    /** @scenario "A read-only key cannot perform a write action" */
    it("forbids the model-provider upsert, which requires project:update", async () => {
      const response = await mount().put(
        "/api/model-providers/openai",
        { enabled: true },
        bearer(READ_ONLY_KEY),
      );

      expect(response.status).toBe(403);
    });
  });
});

describe("given a project key that holds the required permission", () => {
  describe("when it calls the route declaring it", () => {
    /** @scenario "An authorized key passes the permission gate" */
    it("passes the gate on the model-provider listing", async () => {
      const response = await mount().get("/api/model-providers", bearer(ADMIN_KEY));

      expect(response.status).toBe(200);
    });

    it("passes the gate on the model-defaults snapshot", async () => {
      const response = await mount().get("/api/model-defaults", bearer(ADMIN_KEY));

      expect(response.status).toBe(200);
    });

    it("lets an experiments-only key list experiments, decoupled from workflows", async () => {
      const response = await mount().get("/api/experiments", bearer(EXPERIMENTS_ONLY_KEY));

      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });
});

describe("given a key issued for another organization", () => {
  describe("when it targets this organization's project", () => {
    /** @scenario "A key for one organization cannot resolve another organization's project" */
    it("cannot resolve the cross-tenant project at all", async () => {
      const response = await mount().get(
        "/api/model-providers",
        bearer(OTHER_ORGANIZATION_KEY, REST_AUTH_PROJECT.id),
      );

      // 401, not 403: the credential never resolves to the named project, so
      // the refusal is authentication and the permission check never runs.
      expect(response.status).toBe(401);
    });
  });
});

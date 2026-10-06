import { createErrorHandler, ProjectMissingCredentialsError } from "@langwatch/api";
import { bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
/**
 * @vitest-environment node
 * `GET /api/me/usage` through the installed user app; only its peers are doubles.
 * Spec: specs/ai-gateway/governance/me-usage-rest-api.feature
 */
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type {
  GovernanceRestApi,
  PersonalUsageRollup,
} from "@langwatch/enterprise-governance-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import {
  type InternalProject,
  PROJECT_KIND,
  type ProjectApi,
  type ProjectIdentity,
} from "@langwatch/project-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi, type MePersonalCredential } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createUserTestAuth,
  createUserTestOrganizations,
} from "../../app/__tests__/user.fixture.ts";
import { userProcessModule } from "../../user.module.ts";
import { mePersonalCredential, meRest } from "../me.rest.ts";

const ORGANIZATION_ID = "org-1";
const OWNER_ID = "user-owner";
const OTHER_ID = "user-other";
const USAGE_PATH = "/api/me/2026-08-07/usage";

const workspace = (overrides: Partial<ProjectIdentity>): ProjectIdentity => ({
  id: "project-personal-1",
  name: "Ada",
  slug: "ada",
  teamId: "team-personal-1",
  organizationId: ORGANIZATION_ID,
  isPersonal: true,
  ownerUserId: OWNER_ID,
  ...overrides,
});

const governanceProject: InternalProject = {
  id: "project-governance-1",
  name: "Governance",
  slug: "governance",
  teamId: "team-governance-1",
  kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
  archivedAtMs: null,
  traceSharingEnabled: false,
};

const rollup: PersonalUsageRollup = {
  summary: {
    spentUsd: 5,
    billedUsd: 5,
    requests: 3,
    promptTokens: 30,
    completionTokens: 15,
    mostUsedModel: { name: "claude-opus", usagePct: 67 },
  },
  dailyBuckets: [{ day: "2026-09-01", spentUsd: 5, billedUsd: 5, requests: 3 }],
  breakdownByModel: [{ label: "claude-opus", spentUsd: 5, billedUsd: 5, requests: 3 }],
};

const emptyRollup: PersonalUsageRollup = {
  summary: {
    spentUsd: 0,
    billedUsd: 0,
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    mostUsedModel: null,
  },
  dailyBuckets: [{ day: "2026-09-01", spentUsd: 0, billedUsd: 0, requests: 0 }],
  breakdownByModel: [],
};

const OWNER_KEY: MePersonalCredential = {
  kind: "apiKey",
  userId: OWNER_ID,
  organizationId: ORGANIZATION_ID,
};

/** The user app installed over memory stores, mounted behind the REST door. */
async function mounted({
  project = workspace({}),
  credential = OWNER_KEY,
  usage = rollup,
  authenticated = true,
}: {
  project?: ProjectIdentity;
  credential?: MePersonalCredential;
  usage?: PersonalUsageRollup;
  authenticated?: boolean;
} = {}) {
  const personalUsage = vi.fn(async () => usage);
  const runtime = await createApp({ role: "api" })
    .withModules([userProcessModule])
    .withStores(memoryStores())
    .withConfig({ user: { publicBaseUrl: undefined } })
    .withEventing(
      new EventSourcing({ enabled: false, processStore: InMemoryProcessStore.createForTesting() }),
    )
    .provide({
      auth: createUserTestAuth() as AuthApi,
      authz: createApiFixture<AuthzApi>({ listPlatformOperators: async () => [] }),
      "enterprise-gateway": createApiFixture<EnterpriseGatewayApi>(),
      gateway: createApiFixture<GatewayApi>(),
      governance: createApiFixture<GovernanceRestApi>({ personalUsage }),
      notification: createApiFixture<NotificationService>(),
      organization: createUserTestOrganizations(),
      project: createApiFixture<ProjectApi>({
        findIdentity: async () => project,
        findInternal: async () => governanceProject,
      }),
      "stored-object": createApiFixture<StoredObjectApi>(),
    })
    .boot();

  const hono = createRestRuntime({
    identity: {
      authenticate: () => {
        if (!authenticated) throw new ProjectMissingCredentialsError();

        return {
          actor: { type: "api_key", id: "key-1" },
          scope: { tier: "project", id: project.id },
        };
      },
    },
  }).mount(meRest.router(), {
    app: () => runtime.service(UserApi),
    onError: createErrorHandler(),
    facts: [bindRestMiddleware(mePersonalCredential, () => credential)],
  });

  return { hono, personalUsage, stop: () => runtime.stop() };
}

async function get({
  path = USAGE_PATH,
  ...options
}: Parameters<typeof mounted>[0] & { path?: string } = {}) {
  const app = await mounted(options);
  try {
    const response = await app.hono.request(path);
    const text = await response.text();

    return { response, text, body: JSON.parse(text) as Record<string, unknown>, ...app };
  } finally {
    await app.stop();
  }
}

describe("GET /api/me/usage", () => {
  describe("given a key from my own personal workspace", () => {
    /** @scenario "Reading personal usage for the current month" */
    it("answers 200 with the summary, daily buckets and per-model breakdown", async () => {
      const { response, body, personalUsage } = await get();

      expect(response.status).toBe(200);
      expect(body).toEqual(rollup);
      expect(personalUsage).toHaveBeenCalledWith(
        expect.not.objectContaining({ window: expect.anything() }),
      );
    });

    /** @scenario "Reading personal usage for an explicit window" */
    it("hands the requested window to the rollup read, and nothing else", async () => {
      const { response, personalUsage } = await get({
        path: `${USAGE_PATH}?windowStartMs=1000&windowEndMs=2000`,
      });

      expect(response.status).toBe(200);
      expect(personalUsage).toHaveBeenCalledWith(
        expect.objectContaining({ window: { startMs: 1000, endMs: 2000 } }),
      );
    });

    // The scenario says 400; main and this door answer 422 (open question).
    it("refuses a window with only one bound, before anything is read", async () => {
      const { response, body, personalUsage } = await get({
        path: `${USAGE_PATH}?windowStartMs=1000`,
      });

      expect(response.status).toBe(422);
      expect(JSON.stringify(body)).toMatch(/provided together/);
      expect(personalUsage).not.toHaveBeenCalled();
    });

    it("refuses a window whose start is not before its end", async () => {
      const { response, body, personalUsage } = await get({
        path: `${USAGE_PATH}?windowStartMs=2000&windowEndMs=2000`,
      });

      expect(response.status).toBe(422);
      expect(JSON.stringify(body)).toMatch(/must be before/);
      expect(personalUsage).not.toHaveBeenCalled();
    });

    /** @scenario "Empty state is safe" */
    it("answers 200 with zero spend and no most-used model for a workspace with no usage", async () => {
      const { response, body } = await get({ usage: emptyRollup });

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        summary: { spentUsd: 0, requests: 0, mostUsedModel: null },
        dailyBuckets: [{ spentUsd: 0, billedUsd: 0, requests: 0 }],
        breakdownByModel: [],
      });
    });
  });

  describe("given a user-bound key pointed at another user's personal workspace", () => {
    /** @scenario "A key cannot read another user's personal usage" */
    it("answers 403 with a named code and never says whose workspace it is", async () => {
      const { response, text, body, personalUsage } = await get({
        credential: { kind: "apiKey", userId: OTHER_ID, organizationId: ORGANIZATION_ID },
      });

      expect(response.status).toBe(403);
      expect(body).toMatchObject({ code: "personal_usage_key_mismatch" });
      expect(text).not.toContain(OWNER_ID);
      expect(personalUsage).not.toHaveBeenCalled();
    });
  });

  describe("given a key from a shared workspace", () => {
    /** @scenario "A shared-workspace API key is rejected" */
    it("answers 400 naming the personal key it needs, and no internal detail", async () => {
      const { response, text, body } = await get({
        project: workspace({ isPersonal: false, ownerUserId: null }),
      });

      expect(response.status).toBe(400);
      expect(body).toMatchObject({ code: "personal_project_key_required" });
      expect(text).not.toMatch(/ownerUserId|isPersonal/);
    });
  });

  describe("given no API key", () => {
    /** @scenario "Unauthenticated requests are rejected" */
    it("answers 401 before anything is read", async () => {
      const { response, body, personalUsage } = await get({ authenticated: false });

      expect(response.status).toBe(401);
      expect(body).toMatchObject({ code: "missing_credentials" });
      expect(personalUsage).not.toHaveBeenCalled();
    });
  });
});

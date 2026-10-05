import type { ApiKeyApi } from "@langwatch/api-key-contract";
/**
 * @vitest-environment node
 * `/api/organizations` against the real composed application over the module's own
 * in-memory repositories, reached with the instance administrator's key.
 * @see specs/organizations/organizations-provisioning-rest-api.feature
 */
import {
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  UnauthorizedError,
} from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { organizationAppForTesting } from "../../app/__tests__/support/organization-app-for-testing.ts";
import type { OrganizationPromptSeed } from "../../app/organization.members.ts";
import { MemoryGroupRepository } from "../../repositories/memory/memory.group.repository.ts";
import { MemoryOrganizationMembershipRepository } from "../../repositories/memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../../repositories/memory/memory.organization.repository.ts";
import { MemoryTeamRepository } from "../../repositories/memory/memory.team.repository.ts";
import { GroupIdentityService } from "../../services/group-identity.service.ts";
import { OrganizationMembershipService } from "../../services/organization-membership.service.ts";
import { OrganizationService } from "../../services/organization.service.ts";
import { PersonalWorkspaceIdentityService } from "../../services/personal-workspace-identity.service.ts";
import { TeamIdentityService } from "../../services/team-identity.service.ts";
import { organizationsProvisioningRest } from "../organizations.rest.ts";
import { TestAuthzApi } from "./support/test-authz-api.ts";

const INSTANCE_KEY = "instance-administrator-key";
const BOOTSTRAP_TOKEN = "sk-lw-bootstrap";

const onError = createCanonicalFamilyErrorHandler({
  loggerName: "langwatch:test:organizations:errors",
  label: "Organizations API Error",
});

/**
 * The application as `OrganizationModule` is wired at boot, over empty in-memory
 * repositories. `failKeys` makes the bootstrap key's creation refuse, `n` times.
 */
function application({ failKeys = 0 }: { failKeys?: number } = {}) {
  const keyRequests: unknown[] = [];
  const memory = MemoryOrganizationDatabase.create();
  const permissions = TestAuthzApi.create({ people: [] });
  let keyFailuresLeft = failKeys;

  const prompts: OrganizationPromptSeed = {
    seedTagsForOrganization: async () => {},
    reportCompensationFailure: () => {},
  };

  const organizations = OrganizationService.create({
    repository: MemoryOrganizationRepository.create({ memory }),
    teams: MemoryTeamRepository.create({ memory }),
    groups: MemoryGroupRepository.create({ memory }),
    identities: PersonalWorkspaceIdentityService.create(),
    teamIdentities: TeamIdentityService.create(),
    groupIdentities: GroupIdentityService.create(),
    authz: permissions,
    grants: permissions,
    settingsSecrets: { encrypt: (value) => value, decrypt: (value) => value },
  });

  const membership = OrganizationMembershipService.create({
    repository: MemoryOrganizationMembershipRepository.create({ memory }),
    prompts,
    seats: {
      checkLimit: () => Promise.reject(new Error("seat limits are not reached")),
      assertRoleChangeAllowed: () => Promise.reject(new Error("seat limits are not reached")),
    },
    sessions: { revokeAllBrowserSessions: async () => {} },
    grantCache: { invalidateOrganization: async () => {} },
    testArrivals: { standingFor: async () => ({ testing: false }) as const },
    ceiling: { assertWithinCaller: async () => {} },
    admissions: {
      attachBindings: () => Promise.reject(new Error("no admission expected")),
      completeAdmission: () => Promise.reject(new Error("no admission expected")),
    },
  });

  const apiKeys = createApiFixture<ApiKeyApi>(
    {
      create: async (input) => {
        keyRequests.push(input);
        if (keyFailuresLeft > 0) {
          keyFailuresLeft -= 1;
          throw new Error("the key store refused");
        }
        return { token: BOOTSTRAP_TOKEN, apiKey: { id: "key-1" } as never };
      },
    },
    "ApiKeyApi",
  );

  const app = organizationAppForTesting({
    dependencies: {
      organizations,
      membership,
      projects: createApiFixture({}, "ProjectApi"),
      permissions,
      apiKeys,
    },
  });

  return { app, memory, keyRequests };
}

/** The family mounted as the instance administrator's own door: a key, and no tenant. */
function mountProvisioning(app: ReturnType<typeof application>["app"]) {
  const runtime = createRestRuntime({
    identity: {
      identify: ({ request }) => {
        if (request.headers.get("Authorization") !== `Bearer ${INSTANCE_KEY}`) {
          throw new UnauthorizedError("Invalid credential");
        }
        return { actor: { type: "api_key", id: "instance-admin" } as const, scope: null };
      },
      authenticate: () => {
        throw new Error("the instance door asks no permission of its key");
      },
    },
  });
  const hono = runtime.mount(organizationsProvisioningRest.router(), { app: () => app, onError });

  const send = (path: string, init: { method?: string; body?: unknown } = {}) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${INSTANCE_KEY}`, "Content-Type": "application/json" },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  return { hono, send };
}

/**
 * Every address the family lists its organizations on: undated, dated and latest,
 * each with and without v1.
 */
const ROSTER_PATHS = [
  "/api/organizations",
  "/api/v1/organizations",
  "/api/organizations/latest",
  "/api/v1/organizations/latest",
  "/api/organizations/2026-08-07",
  "/api/v1/organizations/2026-08-07",
] as const;

type Provisioned = {
  organization: { id: string; name: string; slug: string };
  adminApiKey: { id: string; token: string };
};

describe("given an instance administrator and an instance with no organizations", () => {
  describe("when an organization is created with a slug outside the documented shape", () => {
    /** @scenario "A slug outside the documented shape is refused" */
    it("refuses with 422 and creates no organization", async () => {
      const { app, memory } = application();
      const { send } = mountProvisioning(app);

      const response = await send("/api/organizations", {
        method: "POST",
        body: { name: "Acme", slug: "Not A Slug" },
      });

      expect(response.status).toBe(422);
      expect(memory.organizations.size).toBe(0);
    });
  });

  describe("when an organization is created with a name and a slug", () => {
    /** @scenario "An instance administrator creates an organization with a bootstrap key" */
    it("answers 201 with its id, name, slug and an admin key whose binding is the new organization", async () => {
      const { app, keyRequests } = application();
      const { send } = mountProvisioning(app);

      const response = await send("/api/organizations", {
        method: "POST",
        body: { name: "Acme", slug: "acme" },
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as Provisioned;
      expect(body.organization).toEqual({ id: expect.any(String), name: "Acme", slug: "acme" });
      expect(body.adminApiKey).toEqual({ id: "key-1", token: BOOTSTRAP_TOKEN });
      expect(keyRequests).toEqual([
        expect.objectContaining({
          organizationId: body.organization.id,
          permissionMode: "all",
          bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: body.organization.id }],
        }),
      ]);
    });
  });

  describe("when the organization's bootstrap key cannot be created", () => {
    /** @scenario "A failed bootstrap key leaves no organization behind" */
    it("fails, leaves no organization with that slug, and lets the slug be provisioned again", async () => {
      const { app, memory } = application({ failKeys: 1 });
      const { send } = mountProvisioning(app);

      const failed = await send("/api/organizations", {
        method: "POST",
        body: { name: "Acme", slug: "acme" },
      });

      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect([...memory.organizations.values()].filter((row) => row.slug === "acme")).toEqual([]);

      const retried = await send("/api/organizations", {
        method: "POST",
        body: { name: "Acme", slug: "acme", adminApiKeyName: "Valid key" },
      });

      expect(retried.status).toBe(201);
      expect([...memory.organizations.values()].filter((row) => row.slug === "acme")).toHaveLength(
        1,
      );
    });
  });
});

describe("given an organization created with the instance administrator's key", () => {
  async function created() {
    const { app } = application();
    const mounted = mountProvisioning(app);
    const response = await mounted.send("/api/organizations", {
      method: "POST",
      body: { name: "Acme", slug: "acme" },
    });
    expect(response.status).toBe(201);

    return { ...mounted, provisioned: (await response.json()) as Provisioned };
  }

  describe("when it is fetched by the id creation returned", () => {
    /** @scenario "Fetching a provisioned organization returns what creation reported" */
    it("answers 200 with the same id, name and slug", async () => {
      const { send, provisioned } = await created();

      const response = await send(`/api/organizations/${provisioned.organization.id}`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ organization: provisioned.organization });
    });
  });

  describe("when an id that no organization has is fetched", () => {
    /** @scenario "Fetching an unknown organization id is not found" */
    it("answers 404", async () => {
      const { send } = await created();

      const response = await send("/api/organizations/organization-that-does-not-exist");

      expect(response.status).toBe(404);
    });
  });

  describe("when the organizations are listed at every path the family answers on", () => {
    /** @scenario "The roster reads the same at every path the family answers on" */
    it("answers the same status and the same roster at each", async () => {
      const { send, provisioned } = await created();

      const answers = await Promise.all(
        ROSTER_PATHS.map(async (path) => {
          const response = await send(path);

          return { path, status: response.status, body: await response.json() };
        }),
      );

      for (const answer of answers) {
        expect(answer.status, answer.path).toBe(200);
        expect(answer.body, answer.path).toEqual(answers[0]!.body);
      }
      expect(answers[0]!.body).toMatchObject({
        organizations: [{ id: provisioned.organization.id, slug: "acme" }],
      });
    });
  });
});

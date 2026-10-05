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

import {
  organizationModuleSetup,
  type OrganizationModuleSetup,
} from "../../app/__tests__/support/organization-module-setup.ts";
import { OrganizationModule } from "../../app/organization.app.ts";
import { organizationsProvisioningRest } from "../organizations.rest.ts";
import { TestAuthzApi } from "./support/test-authz-api.ts";

const INSTANCE_KEY = "instance-administrator-key";
const BOOTSTRAP_TOKEN = "sk-lw-bootstrap";

const onError = createCanonicalFamilyErrorHandler({
  loggerName: "langwatch:test:organizations:errors",
  label: "Organizations API Error",
});

/**
 * The application `OrganizationModule.create` builds over the empty memory tier of its own
 * registry. `failKeys` makes the bootstrap key's creation refuse, `n` times.
 */
async function application({ failKeys = 0 }: { failKeys?: number } = {}) {
  const keyRequests: unknown[] = [];
  const permissions = TestAuthzApi.create({ people: [] });
  let keyFailuresLeft = failKeys;

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

  const setup = organizationModuleSetup({ permissions, apiKeys });
  const app = await OrganizationModule.create(setup);

  return { app, repositories: setup.repositories, permissions, keyRequests };
}

/** The slugs of every organization the registry holds. */
async function storedSlugs(
  repositories: OrganizationModuleSetup["repositories"],
  permissions: TestAuthzApi,
): Promise<string[]> {
  const summaries = await repositories.membership(permissions).findAllProvisioningSummaries();
  return summaries.map((summary) => summary.slug);
}

/** The family mounted as the instance administrator's own door: a key, and no tenant. */
function mountProvisioning(app: OrganizationModule) {
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
      const { app, repositories, permissions } = await application();
      const { send } = mountProvisioning(app);

      const response = await send("/api/organizations", {
        method: "POST",
        body: { name: "Acme", slug: "Not A Slug" },
      });

      expect(response.status).toBe(422);
      expect(await storedSlugs(repositories, permissions)).toEqual([]);
    });
  });

  describe("when an organization is created with a name and a slug", () => {
    /** @scenario "An instance administrator creates an organization with a bootstrap key" */
    it("answers 201 with its id, name, slug and an admin key whose binding is the new organization", async () => {
      const { app, keyRequests } = await application();
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
      const { app, repositories, permissions } = await application({ failKeys: 1 });
      const { send } = mountProvisioning(app);

      const failed = await send("/api/organizations", {
        method: "POST",
        body: { name: "Acme", slug: "acme" },
      });

      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(await storedSlugs(repositories, permissions)).not.toContain("acme");

      const retried = await send("/api/organizations", {
        method: "POST",
        body: { name: "Acme", slug: "acme", adminApiKeyName: "Valid key" },
      });

      expect(retried.status).toBe(201);
      expect(await storedSlugs(repositories, permissions)).toEqual(["acme"]);
    });
  });
});

describe("given an organization created with the instance administrator's key", () => {
  async function created() {
    const { app } = await application();
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

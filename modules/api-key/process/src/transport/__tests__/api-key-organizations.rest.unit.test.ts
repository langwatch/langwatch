/**
 * @vitest-environment node
 * `POST /api/organizations` at organization's path, served by api-key over the real
 * provisioning service; organization's operations and the key mint are faked.
 * @see specs/organizations/organizations-provisioning-rest-api.feature
 */
import {
  OrganizationInvalidCredentialsError,
  OrganizationMissingCredentialsError,
} from "@langwatch/api";
import type { ApiKey, ApiKeyApi } from "@langwatch/api-key-contract";
import { createCanonicalFamilyErrorHandler, createRestRuntime } from "@langwatch/api/rest";
import {
  OrganizationSlugTakenError,
  type OrganizationApi,
  type OrganizationProvisioningSummary,
} from "@langwatch/organization-contract";
import { LocalFeatureApis } from "@langwatch/process";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { OrganizationProvisioningService } from "../../services/organization-provisioning.service.ts";
import {
  apiKeyOrganizationsRest,
  ApiKeyOrganizationsDoorApi,
} from "../api-key-organizations.rest.ts";

const INSTANCE_KEY = "instance-administrator-key";
const BOOTSTRAP_TOKEN = "sk-lw-bootstrap";

const onError = createCanonicalFamilyErrorHandler({
  loggerName: "langwatch:test:organizations:errors",
  label: "Organizations API Error",
});

/** Organization's provisioning operations over a slug map; `failKeys` refuses that many mints. */
function mount({ failKeys = 0 }: { failKeys?: number } = {}) {
  const slugs = new Map<string, string>();
  const keyRequests: unknown[] = [];
  let keyFailuresLeft = failKeys;

  const organizations = createApiFixture<OrganizationApi>(
    {
      createForProvisioning: async ({ name, slug = "generated" }) => {
        if ([...slugs.values()].includes(slug)) throw new OrganizationSlugTakenError(slug);
        const id = `organization-${slugs.size + 1}`;
        slugs.set(id, slug);
        return { organization: { id, name }, team: { id: `team-${id}`, slug, name } };
      },
      findProvisioningSummary: async (id) => {
        const slug = slugs.get(id);
        const summary: OrganizationProvisioningSummary = {
          id,
          name: "Acme",
          slug: slug ?? "",
          createdAt: nowInstant(),
        };
        return slug === undefined ? null : summary;
      },
      deleteProvisionedOrganization: async ({ organizationId }) => {
        slugs.delete(organizationId);
      },
    },
    "OrganizationApi",
  );
  const apiKeys = createApiFixture<ApiKeyApi>(
    {
      create: async (input) => {
        keyRequests.push(input);
        if (keyFailuresLeft > 0) {
          keyFailuresLeft -= 1;
          throw new Error("the key store refused");
        }
        return { token: BOOTSTRAP_TOKEN, apiKey: { id: "key-1" } as ApiKey };
      },
    },
    "ApiKeyApi",
  );
  const provisioning = OrganizationProvisioningService.create({ apiKeys, organizations });
  const apis = new LocalFeatureApis();
  apis.declare(ApiKeyOrganizationsDoorApi);
  apis.bind(ApiKeyOrganizationsDoorApi, {
    provisionOrganization: (input) => provisioning.provisionOrganization(input),
  });
  apis.ready();

  const runtime = createRestRuntime({
    audit: { record: async () => {} },
    authorization: restTestAuthorization(),
    identity: {
      identify: ({ request }) => {
        const presented = request.headers.get("Authorization");
        if (presented === null) throw new OrganizationMissingCredentialsError();
        if (presented !== `Bearer ${INSTANCE_KEY}`) throw new OrganizationInvalidCredentialsError();
        return { actor: { type: "api_key", id: "instance-admin" } as const, scope: null };
      },
      authenticate: () => {
        throw new Error("the instance door asks no permission of its key");
      },
    },
  });
  const hono = runtime.mount(apiKeyOrganizationsRest.router(), {
    app: () => apis.reference(ApiKeyOrganizationsDoorApi),
    onError,
  });
  const post = (body: unknown) =>
    hono.fetch(
      new Request("http://api.test/api/organizations", {
        method: "POST",
        headers: { Authorization: `Bearer ${INSTANCE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  return { post, keyRequests, storedSlugs: () => [...slugs.values()] };
}

describe("organization provisioning, served by api-key", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps organization's path, operation, status and credential", () => {
      const declaration = apiKeyOrganizationsRest.router();

      expect(
        declaration.routes.map((route) => [
          route.method,
          route.path,
          route.operation,
          route.status,
          route.sharedPath?.owner,
        ]),
      ).toEqual([["post", "/", "provisionOrganization", 201, "organization"]]);
      expect(declaration.credential).toBe("instance_admin");
    });
  });

  describe("when an organization is created with a slug outside the documented shape", () => {
    /** @scenario "A slug outside the documented shape is refused" */
    it("refuses with 422 and creates no organization", async () => {
      const { post, storedSlugs } = mount();

      const response = await post({ name: "Acme", slug: "Not A Slug" });

      expect(response.status).toBe(422);
      expect(storedSlugs()).toEqual([]);
    });
  });

  describe("when an organization is created with a name and a slug", () => {
    /** @scenario "An instance administrator creates an organization with a bootstrap key" */
    it("answers 201 with its id, name, slug and an admin key bound to the new organization", async () => {
      const { post, keyRequests } = mount();

      const response = await post({ name: "Acme", slug: "acme" });

      expect(response.status).toBe(201);
      const body = (await response.json()) as { organization: { id: string } };
      expect(body).toEqual({
        organization: { id: "organization-1", name: "Acme", slug: "acme" },
        team: { id: "team-organization-1", slug: "acme", name: "Acme" },
        adminApiKey: { id: "key-1", token: BOOTSTRAP_TOKEN },
      });
      expect(keyRequests).toEqual([
        expect.objectContaining({
          name: "Provisioning admin",
          userId: null,
          organizationId: body.organization.id,
          permissionMode: "all",
          bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: body.organization.id }],
        }),
      ]);
    });
  });

  describe("when a second organization is created with a slug that is taken", () => {
    /** @scenario "A duplicate organization slug is refused" */
    it("refuses with organization_slug_taken and 409 and mints no second key", async () => {
      const { post, keyRequests, storedSlugs } = mount();
      expect((await post({ name: "Acme", slug: "acme" })).status).toBe(201);

      const second = await post({ name: "Acme Again", slug: "acme" });

      expect(second.status).toBe(409);
      expect(((await second.json()) as { code: string }).code).toBe("organization_slug_taken");
      expect(storedSlugs()).toEqual(["acme"]);
      expect(keyRequests).toHaveLength(1);
    });
  });

  describe("when the organization's bootstrap key cannot be created", () => {
    /** @scenario "A failed bootstrap key leaves no organization behind" */
    it("fails, deletes the organization, and lets the slug be provisioned again", async () => {
      const { post, storedSlugs } = mount({ failKeys: 1 });

      const failed = await post({ name: "Acme", slug: "acme" });

      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(storedSlugs()).toEqual([]);
      const retried = await post({ name: "Acme", slug: "acme", adminApiKeyName: "Valid key" });
      expect(retried.status).toBe(201);
      expect(storedSlugs()).toEqual(["acme"]);
    });
  });
});

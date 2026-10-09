/**
 * @vitest-environment node
 * `/api/organizations` against the real composed application over the module's own
 * in-memory repositories, reached with the instance administrator's key.
 * @see specs/organizations/organizations-provisioning-rest-api.feature
 */
import {
  OrganizationInvalidCredentialsError,
  OrganizationMissingCredentialsError,
} from "@langwatch/api";
import { createCanonicalFamilyErrorHandler, createRestRuntime } from "@langwatch/api/rest";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import {
  organizationModuleSetup,
  type OrganizationModuleSetup,
} from "../../app/__tests__/support/organization-module-setup.ts";
import { OrganizationModule } from "../../app/organization.app.ts";
import { organizationsProvisioningRest } from "../organizations.rest.ts";
import { TestAuthzApi } from "./support/test-authz-api.ts";

const INSTANCE_KEY = "instance-administrator-key";

const onError = createCanonicalFamilyErrorHandler({
  loggerName: "langwatch:test:organizations:errors",
  label: "Organizations API Error",
});

/** The application `OrganizationModule.create` builds over its own registry's empty memory tier. */
async function application() {
  const permissions = TestAuthzApi.create({ people: [] });
  const setup = organizationModuleSetup({ permissions });
  const app = await OrganizationModule.create(setup);
  const accepts = { send: async () => undefined };
  app.connectLifecycle({
    recordCreated: accepts,
    recordSignedUp: accepts,
    recordMembersInvited: accepts,
    recordInviteAccepted: accepts,
    recordIntegrationMethodChosen: accepts,
    recordPersonalWorkspaceProvisioned: accepts,
    recordPersonalTeamCreated: accepts,
    recordPersonalWorkspaceArchived: accepts,
    recordPersonalWorkspaceRevived: accepts,
    recordPersonalWorkspaceFeaturesChanged: accepts,
    recordPresenceSettingChanged: accepts,
    recordTraceSharingDisabled: accepts,
    recordMemberDisabled: accepts,
  });

  return { app, repositories: setup.repositories, permissions };
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
  const hono = runtime.mount(organizationsProvisioningRest.router(), { app: () => app, onError });

  const send = (
    path: string,
    init: { method?: string; body?: unknown; credential?: string | null } = {},
  ) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: {
          ...(init.credential === null
            ? {}
            : { Authorization: `Bearer ${init.credential ?? INSTANCE_KEY}` }),
          "Content-Type": "application/json",
        },
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

describe("given an instance with no organizations", () => {
  describe("when a second organization is provisioned with a slug that is taken", () => {
    /** @scenario "A duplicate organization slug is refused" */
    it("refuses with organization_slug_taken and keeps one organization", async () => {
      const { app, repositories, permissions } = await application();
      await app.createForProvisioning({ name: "Acme", slug: "acme" });

      await expect(
        app.createForProvisioning({ name: "Acme Again", slug: "acme" }),
      ).rejects.toMatchObject({ code: "organization_slug_taken" });
      expect(await storedSlugs(repositories, permissions)).toEqual(["acme"]);
    });
  });

  describe("when a provisioned organization is deleted after its bootstrap key failed", () => {
    /** @scenario "A failed bootstrap key leaves no organization behind" */
    it("leaves no organization with that slug and lets the slug be provisioned again", async () => {
      const { app, repositories, permissions } = await application();
      const created = await app.createForProvisioning({ name: "Acme", slug: "acme" });

      await app.deleteProvisionedOrganization({ organizationId: created.organization.id });
      expect(await storedSlugs(repositories, permissions)).not.toContain("acme");

      await app.createForProvisioning({ name: "Acme", slug: "acme" });
      expect(await storedSlugs(repositories, permissions)).toEqual(["acme"]);
    });
  });
});

describe("given an organization provisioned on the instance", () => {
  async function created() {
    const { app } = await application();
    const mounted = mountProvisioning(app);
    const { organization } = await app.createForProvisioning({ name: "Acme", slug: "acme" });

    return { ...mounted, app, provisioned: { organization: { ...organization, slug: "acme" } } };
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

  describe("when the organizations are listed without the instance key", () => {
    /** @scenario "Listing organizations requires the instance key" */
    it("refuses a missing credential and a foreign one, and lists both with the key", async () => {
      const { app, send, provisioned } = await created();
      await app.createForProvisioning({ name: "Beta", slug: "beta" });

      const missing = await send("/api/organizations", { credential: null });
      expect(missing.status).toBe(401);
      expect(await missing.json()).toMatchObject({ code: "missing_credentials" });

      const foreign = await send("/api/organizations", { credential: "not-the-instance-key" });
      expect(foreign.status).toBe(401);
      expect(await foreign.json()).toMatchObject({ code: "invalid_credentials" });

      const listed = (await (await send("/api/organizations")).json()) as {
        organizations: { slug: string }[];
      };
      expect(listed.organizations.map((organization) => organization.slug).toSorted()).toEqual(
        [provisioned.organization.slug, "beta"].toSorted(),
      );
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

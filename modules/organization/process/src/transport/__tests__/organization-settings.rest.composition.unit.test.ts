import {
  bindRestMiddleware,
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  UnauthorizedError,
} from "@langwatch/api/rest";
/**
 * @vitest-environment node
 * `/api/organization` profile against the real composed application over the module's own
 * in-memory repositories: a request changes state, a follow-up request reads it.
 * @see specs/organizations/organization-rest-api.feature
 */
import { describe, expect, it } from "vitest";

import { organizationModuleSetup } from "../../app/__tests__/support/organization-module-setup.ts";
import { OrganizationModule } from "../../app/organization.app.ts";
import {
  organizationKeyFacts,
  organizationManagementRest,
} from "../organization-management.rest.ts";
import { TestAuthzApi } from "./support/test-authz-api.ts";

const ORGANIZATION_ID = "organization-1";
const ADMIN_ID = "user-admin";
const CREDENTIAL = "organization-credential";

const onError = createCanonicalFamilyErrorHandler({
  loggerName: "langwatch:test:organization-settings:errors",
  label: "Organization API Error",
});

/** One organization named ACME and its administrator, the family mounted over the real app. */
async function application() {
  const permissions = TestAuthzApi.create({
    people: [{ id: ADMIN_ID, name: "Admin", email: "admin@acme.test" }],
  });
  const setup = organizationModuleSetup({ permissions });
  await setup.repositories.membership(permissions).createAndAssign({
    userId: ADMIN_ID,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: "team-1",
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  const app = await OrganizationModule.create(setup);

  const door = () => ({
    actor: { type: "user" as const, id: ADMIN_ID },
    scope: { tier: "organization" as const, id: ORGANIZATION_ID },
  });
  const requireCredential = (request: Request) => {
    if (request.headers.get("Authorization") !== `Bearer ${CREDENTIAL}`) {
      throw new UnauthorizedError("Invalid credential");
    }
    return door();
  };
  const runtime = createRestRuntime({
    identity: {
      identify: ({ request }) => requireCredential(request),
      authenticate: ({ request }) => requireCredential(request),
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
    entitlements: { holds: async () => true },
  });
  const hono = runtime.mount(organizationManagementRest.router(), {
    app: () => app,
    onError,
    facts: [bindRestMiddleware(organizationKeyFacts, () => ({ apiKeyId: "key-1" }))],
  });
  const send = (path: string, init: { method?: string; body?: unknown } = {}) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  return { send, app };
}

describe("given an organization named ACME reached with its organization key", () => {
  describe("when the organization is renamed", () => {
    /** @scenario "Renaming the organization takes effect" */
    it("answers 200 with the new name and fetching the organization returns it", async () => {
      const { send } = await application();

      const renamed = await send("/api/organization", {
        method: "PATCH",
        body: { name: "Acme Platform" },
      });
      const fetched = await send("/api/organization");

      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({ id: ORGANIZATION_ID, name: "Acme Platform" });
      expect(fetched.status).toBe(200);
      expect(await fetched.json()).toMatchObject({ id: ORGANIZATION_ID, name: "Acme Platform" });
    });
  });
});

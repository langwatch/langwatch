/**
 * @vitest-environment node
 * `/api/organization` on a real declaration over an application fixture: what each route
 * asks of the application and how it answers.
 * @see specs/organizations/organization-rest-api.feature
 * @see specs/organizations/organization-members-rest-api.feature
 */
import {
  OrganizationInvalidCredentialsError,
  OrganizationMissingCredentialsError,
} from "@langwatch/api";
import {
  bindRestMiddleware,
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  organizationKeyFacts,
  organizationManagementRest,
} from "../organization-management.rest.ts";

const ORGANIZATION_ID = "organization-1";
const CREDENTIAL = "organization-credential";
const CREATED_AT = Temporal.Instant.from("2026-09-01T00:00:00.000Z");

const onError = createCanonicalFamilyErrorHandler({
  loggerName: "langwatch:test:organization-management:errors",
  label: "Organization API Error",
});

function mount(app: Partial<OrganizationApi>) {
  const admit = (request: Request) => {
    const presented = request.headers.get("Authorization");
    if (presented === null) throw new OrganizationMissingCredentialsError();
    if (presented !== `Bearer ${CREDENTIAL}`) throw new OrganizationInvalidCredentialsError();
    return {
      actor: { type: "user" as const, id: "user-owner" },
      scope: { tier: "organization" as const, id: ORGANIZATION_ID },
    };
  };
  const runtime = createRestRuntime({
    identity: {
      identify: ({ request }) => admit(request),
      authenticate: ({ request }) => admit(request),
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
    entitlements: { holds: async () => true },
  });
  const hono = runtime.mount(organizationManagementRest.router(), {
    app: () => createApiFixture<OrganizationApi>(app),
    onError,
    facts: [bindRestMiddleware(organizationKeyFacts, () => ({ apiKeyId: "key-1" }))],
  });

  return (
    path: string,
    init: { method?: string; body?: unknown; credential?: string | null } = {},
  ) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: {
          ...(init.credential === null
            ? {}
            : { Authorization: `Bearer ${init.credential ?? CREDENTIAL}` }),
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );
}

const settings = {
  id: ORGANIZATION_ID,
  name: "Acme",
  slug: "acme",
  supportContact: "help@acme.test",
  presenceEnabled: true,
  traceSharingEnabled: false,
  primaryIntent: null,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3Bucket: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

const member = (userId: string, disabledAt: Instant | null) => ({
  userId,
  organizationId: ORGANIZATION_ID,
  role: "MEMBER" as const,
  disabledAt,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  user: { id: userId, name: userId, email: `${userId}@acme.test` },
});

describe("given the /api/organization family", () => {
  describe("when the organization is fetched", () => {
    /** @scenario "Fetching the organization returns the caller's organization" */
    it("asks for the credential's own organization and answers its profile with 200", async () => {
      const getSettings = vi.fn(async () => settings);
      const send = mount({ getSettings });

      const response = await send("/api/organization");

      expect(response.status).toBe(200);
      expect(getSettings).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID });
      expect(await response.json()).toMatchObject({
        name: "Acme",
        slug: "acme",
        supportContact: "help@acme.test",
        presenceEnabled: true,
        traceSharingEnabled: false,
      });
    });
  });

  describe("when the organization is fetched with no authorization header", () => {
    /** @scenario "Fetching the organization without credentials is refused" */
    it("answers 401 before the application is asked anything", async () => {
      const getSettings = vi.fn(async () => settings);
      const send = mount({ getSettings });

      const response = await send("/api/organization", { credential: null });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "missing_credentials" });
      expect(getSettings).not.toHaveBeenCalled();
    });
  });

  describe("when the organization has single sign-on configured", () => {
    const withSso = { ...settings, ssoDomain: "acme.test", ssoProvider: "okta" };

    /** @scenario "Single sign-on fields are not exposed" */
    it("answers a profile with neither the domain nor the provider", async () => {
      const send = mount({ getSettings: async () => withSso });

      const body = await (await send("/api/organization")).json();

      expect(body).not.toHaveProperty("ssoDomain");
      expect(body).not.toHaveProperty("ssoProvider");
    });

    /** @scenario "Single sign-on fields are not exposed" */
    it("never hands an update's single sign-on fields on to the application", async () => {
      const updateSettings = vi.fn(async () => ({ traceShareRevocationRequired: false }));
      const send = mount({ updateSettings, getSettings: async () => withSso });

      const response = await send("/api/organization", {
        method: "PATCH",
        body: { presenceEnabled: false, ssoDomain: "evil.test", ssoProvider: "evil" },
      });

      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateSettings).toHaveBeenCalledWith(
        { organizationId: ORGANIZATION_ID, presenceEnabled: false },
        { id: "user-owner" },
      );
      expect(await response.json()).not.toHaveProperty("ssoDomain");
    });
  });

  describe("when the organization is fetched through each version namespace", () => {
    const send = mount({ getSettings: async () => settings });

    /** @scenario "The organization endpoint answers on its dated and latest paths" */
    it("names the dated version stable and the latest, bare and unknown paths as they are", async () => {
      const dated = await send(`/api/organization/${MANAGEMENT_API_VERSION}`);
      expect(dated.status).toBe(200);
      expect(dated.headers.get("X-API-Version")).toBe(MANAGEMENT_API_VERSION);
      expect(dated.headers.get("X-API-Version-Status")).toBe("stable");

      const latest = await send("/api/organization/latest");
      expect(latest.status).toBe(200);
      expect(latest.headers.get("X-API-Version-Status")).toBe("latest");

      const bare = await send("/api/organization");
      expect(bare.status).toBe(200);
      expect(bare.headers.get("X-API-Version-Status")).toBe("latest");

      expect((await send("/api/organization/not-a-version")).status).toBe(404);
    });
  });

  describe("when the organization's name is updated to an empty string", () => {
    /** @scenario "An empty organization name is refused" */
    it("refuses with validation_error and writes nothing", async () => {
      const updateSettings = vi.fn();
      const send = mount({ updateSettings, getSettings: async () => settings });

      const response = await send("/api/organization", { method: "PATCH", body: { name: "" } });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation_error" });
      expect(updateSettings).not.toHaveBeenCalled();
    });
  });

  describe("when a member updates the organization", () => {
    /** @scenario "Both doors that save organization settings name who saved them" */
    it("tells the organization service the member who saved it", async () => {
      const updateSettings = vi.fn(async () => ({ traceShareRevocationRequired: false }));
      const send = mount({ updateSettings, getSettings: async () => settings });

      const response = await send("/api/organization", {
        method: "PATCH",
        body: { presenceEnabled: false },
      });

      expect(response.status).toBe(200);
      expect(updateSettings).toHaveBeenCalledWith(
        { organizationId: ORGANIZATION_ID, presenceEnabled: false },
        { id: "user-owner" },
      );
    });
  });

  describe("when a member's access breakdown is fetched", () => {
    const binding = (
      id: string,
      scopeType: "PROJECT" | "TEAM" | "ORGANIZATION",
      scopeId: string,
    ) => ({
      id,
      role: "MEMBER",
      customRoleName: null,
      scopeType,
      scopeId,
      scopeName: scopeId,
      permissions: ["traces:view"],
    });

    /** @scenario "A member's access breakdown spans teams and projects" */
    it("answers the role, group bindings and direct bindings on every scope, each with its source", async () => {
      const getMemberAccessBreakdown = vi.fn(async () => ({
        user: {
          id: "user-1",
          name: "user-1",
          email: "user-1@acme.test",
          orgRole: "MEMBER" as const,
          orgRolePermissions: ["organization:view"],
        },
        groups: [
          {
            id: "group-1",
            name: "Core",
            slug: "core",
            scimSource: null,
            bindings: [binding("b-team", "TEAM", "team-1")],
          },
        ],
        directBindings: [
          binding("b-org", "ORGANIZATION", ORGANIZATION_ID),
          binding("b-project", "PROJECT", "project-1"),
        ],
      }));
      const send = mount({
        getMember: async () => ({ ...member("user-1", null), teams: [] }),
        getMemberAccessBreakdown,
      });

      const response = await send("/api/organization/members/user-1/access");

      expect(response.status).toBe(200);
      expect(getMemberAccessBreakdown).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID, userId: "user-1" }),
      );
      const body = (await response.json()) as {
        user: { orgRole: string };
        groups: { name: string; bindings: { scopeType: string }[] }[];
        directBindings: { scopeType: string }[];
      };
      expect(body.user.orgRole).toBe("MEMBER");
      expect(body.groups.map((group) => [group.name, group.bindings[0]?.scopeType])).toEqual([
        ["Core", "TEAM"],
      ]);
      expect(body.directBindings.map((entry) => entry.scopeType)).toEqual([
        "ORGANIZATION",
        "PROJECT",
      ]);
    });
  });

  describe("when the members are listed", () => {
    /** @scenario "Listing members returns roles and status" */
    it("answers each member's id, name, email, role and disabled flag, disabled ones only when asked", async () => {
      const listMembers = vi.fn(async (input: { includeDisabled?: boolean }) => ({
        members: input.includeDisabled
          ? [member("ana", null), member("bo", CREATED_AT)]
          : [member("ana", null)],
        totalCount: input.includeDisabled ? 2 : 1,
      }));
      const send = mount({ listMembers });

      const plain = await send("/api/organization/members");
      const asked = await send("/api/organization/members?includeDisabled=true");

      expect(plain.status).toBe(200);
      expect(await plain.json()).toMatchObject({
        members: [
          {
            userId: "ana",
            role: "MEMBER",
            disabled: false,
            user: { name: "ana", email: "ana@acme.test" },
          },
        ],
        totalCount: 1,
      });
      expect(listMembers).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ includeDisabled: false }),
      );
      expect(await asked.json()).toMatchObject({
        members: [
          { userId: "ana", disabled: false },
          { userId: "bo", disabled: true },
        ],
        totalCount: 2,
      });
      expect(listMembers).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ includeDisabled: true }),
      );
    });
  });
});

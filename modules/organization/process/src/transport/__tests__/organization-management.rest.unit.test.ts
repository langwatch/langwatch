/**
 * @vitest-environment node
 * `/api/organization` on a real declaration over an application fixture: what each route
 * asks of the application and how it answers.
 * @see specs/organizations/organization-rest-api.feature
 * @see specs/organizations/organization-members-rest-api.feature
 */
import {
  bindRestMiddleware,
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  UnauthorizedError,
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
    if (request.headers.get("Authorization") !== `Bearer ${CREDENTIAL}`) {
      throw new UnauthorizedError("Invalid credential");
    }
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

  return (path: string, init: { method?: string; body?: unknown } = {}) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
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

/**
 * @vitest-environment node
 *
 * @see specs/organizations/organization-rest-api.feature
 *
 * The organization profile over REST: the organization is implied by the
 * credential, reads return what writes accept, and the fields this API does
 * not own (single sign-on, the S3 secret) never appear. Also pins the
 * X-API-Version serving behavior: the dated and latest namespaces serve with
 * version headers while only the bare path is the documented one.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  ENTERPRISE_TEST_PLAN,
  type ManagementTestOrg,
  seedManagementOrg,
} from "~/test-utils/managementApiOrg";
import { app } from "../[[...route]]/app";

describe("Feature: Organization REST API", () => {
  const ns = `org-rest-${nanoid(8)}`;

  let seeded: ManagementTestOrg;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;

  const authHeaders = () => ({
    Authorization: `Bearer ${seeded.adminToken}`,
    "Content-Type": "application/json",
  });

  beforeAll(async () => {
    await resetApp();
    mockGetActivePlan = vi.fn().mockResolvedValue(ENTERPRISE_TEST_PLAN);
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
    });

    seeded = await seedManagementOrg({ prisma, ns });
  });

  afterAll(async () => {
    try {
      await cleanupTestRows(prisma, [
        ["roleBinding", { organizationId: seeded?.organization.id }],
        ["apiKey", { organizationId: seeded?.organization.id }],
        ["organizationUser", { organizationId: seeded?.organization.id }],
        ["user", { id: seeded?.adminUserId }],
        ["organization", { id: seeded?.organization.id }],
      ]);
    } finally {
      // The suite swapped the global app; leaving its mocked plan provider
      // installed would cascade into every later suite of the serial run.
      await resetApp();
    }
  });

  describe("given an organization-scoped admin credential", () => {
    /** @scenario Fetching the organization returns the caller's organization */
    it("returns the caller's organization with its profile settings", async () => {
      const response = await app.request("/api/organization", {
        headers: authHeaders(),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(seeded.organization.id);
      expect(body.name).toBe(seeded.organization.name);
      expect(body.slug).toBe(seeded.organization.slug);
      expect(body).toHaveProperty("supportContact");
      expect(typeof body.presenceEnabled).toBe("boolean");
      expect(typeof body.traceSharingEnabled).toBe("boolean");
    });

    /** @scenario Renaming the organization takes effect */
    it("applies a rename and reads it back", async () => {
      const response = await app.request("/api/organization", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: `Acme Platform ${ns}` }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.name).toBe(`Acme Platform ${ns}`);

      const readBack = await app.request("/api/organization", {
        headers: authHeaders(),
      });
      expect((await readBack.json()).name).toBe(`Acme Platform ${ns}`);
    });

    /** @scenario An empty organization name is refused */
    it("refuses an empty name with validation_error and leaves the name unchanged", async () => {
      const before = await prisma.organization.findUniqueOrThrow({
        where: { id: seeded.organization.id },
        select: { name: true },
      });

      const response = await app.request("/api/organization", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: "" }),
      });

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe("validation_error");

      const after = await prisma.organization.findUniqueOrThrow({
        where: { id: seeded.organization.id },
        select: { name: true },
      });
      expect(after.name).toBe(before.name);
    });

    /** @scenario Single sign-on fields are not exposed */
    it("never returns the SSO fields and ignores attempts to set them", async () => {
      await prisma.organization.update({
        where: { id: seeded.organization.id },
        data: { ssoDomain: `sso-${ns}.example.com`, ssoProvider: "okta" },
      });

      const read = await app.request("/api/organization", {
        headers: authHeaders(),
      });
      expect(read.status).toBe(200);
      const body = await read.json();
      expect(body).not.toHaveProperty("ssoDomain");
      expect(body).not.toHaveProperty("ssoProvider");
      expect(JSON.stringify(body)).not.toContain(`sso-${ns}.example.com`);

      const update = await app.request("/api/organization", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          name: `SSO Untouched ${ns}`,
          ssoDomain: "attacker.example.com",
          ssoProvider: "evil",
        }),
      });
      expect(update.status).toBe(200);

      const stored = await prisma.organization.findUniqueOrThrow({
        where: { id: seeded.organization.id },
        select: { ssoDomain: true, ssoProvider: true },
      });
      expect(stored.ssoDomain).toBe(`sso-${ns}.example.com`);
      expect(stored.ssoProvider).toBe("okta");
    });
  });

  describe("given no credential", () => {
    /** @scenario Fetching the organization without credentials is refused */
    it("refuses with missing_credentials and 401", async () => {
      const response = await app.request("/api/organization");

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.code).toBe("missing_credentials");
    });
  });

  describe("when the same endpoint is addressed through its version namespaces", () => {
    it("serves the dated, latest and bare paths, with only the bare one undated", async () => {
      // The versioned namespaces address the family root with a trailing
      // slash (the framework's canonical dated URL shape).
      const dated = await app.request(
        `/api/organization/${MANAGEMENT_API_VERSION}/`,
        { headers: authHeaders() },
      );
      expect(dated.status).toBe(200);
      expect(dated.headers.get("X-API-Version")).toBe(MANAGEMENT_API_VERSION);
      expect(dated.headers.get("X-API-Version-Status")).toBe("stable");

      const latest = await app.request("/api/organization/latest/", {
        headers: authHeaders(),
      });
      expect(latest.status).toBe(200);
      expect(latest.headers.get("X-API-Version")).toBe("latest");
      expect(latest.headers.get("X-API-Version-Status")).toBe("latest");

      const bare = await app.request("/api/organization", {
        headers: authHeaders(),
      });
      expect(bare.status).toBe(200);
      expect(bare.headers.get("X-API-Version")).toBeNull();
      expect(bare.headers.get("X-API-Version-Status")).toBe("unversioned");

      const unknownVersion = await app.request("/api/organization/2020-01-01", {
        headers: authHeaders(),
      });
      expect(unknownVersion.status).toBe(404);
    });
  });
});

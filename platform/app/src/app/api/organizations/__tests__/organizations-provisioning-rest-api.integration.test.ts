/**
 * @vitest-environment node
 *
 * @see specs/organizations/organizations-provisioning-rest-api.feature
 *
 * The one management surface that exists before any organization does. It
 * authenticates against the instance credential, hands back a bootstrap
 * admin key that immediately works against the management APIs, refuses a
 * taken slug deterministically, and is absent (404, not forbidden) when
 * the credential is not configured or the deployment is cloud.
 */
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { app as organizationApp } from "~/app/api/organization/[[...route]]/app";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { ENTERPRISE_TEST_PLAN } from "~/test-utils/managementApiOrg";
import { app } from "../[[...route]]/app";

describe("Feature: Organization provisioning REST API for self-hosted deployments", () => {
  // Slugs are lowercase-and-hyphens by contract, and nanoid's alphabet is
  // not, so the namespace woven into slugs is sanitised to slug shape.
  const ns = `org-prov-${nanoid(8)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const instanceKey = `instance-admin-${nanoid(24)}`;
  const createdOrganizationIds: string[] = [];

  let previousInstanceKey: string | undefined;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;

  const instanceHeaders = () => ({
    Authorization: `Bearer ${instanceKey}`,
    "Content-Type": "application/json",
  });

  const provision = async (body: Record<string, unknown>) => {
    const response = await app.request("/api/organizations", {
      method: "POST",
      headers: instanceHeaders(),
      body: JSON.stringify(body),
    });
    if (response.status === 201) {
      const cloned = await response.clone().json();
      createdOrganizationIds.push(cloned.organization.id);
    }
    return response;
  };

  const installSelfHostedApp = () => {
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
    });
  };

  beforeAll(async () => {
    previousInstanceKey = process.env.LANGWATCH_INSTANCE_ADMIN_API_KEY;
    process.env.LANGWATCH_INSTANCE_ADMIN_API_KEY = instanceKey;

    await resetApp();
    mockGetActivePlan = vi.fn().mockResolvedValue(ENTERPRISE_TEST_PLAN);
    installSelfHostedApp();
  });

  afterEach(() => {
    // Individual scenarios unset the credential or swap the app; every test
    // starts from the configured, self-hosted baseline.
    process.env.LANGWATCH_INSTANCE_ADMIN_API_KEY = instanceKey;
    installSelfHostedApp();
  });

  afterAll(async () => {
    if (previousInstanceKey === undefined) {
      delete process.env.LANGWATCH_INSTANCE_ADMIN_API_KEY;
    } else {
      process.env.LANGWATCH_INSTANCE_ADMIN_API_KEY = previousInstanceKey;
    }

    try {
      for (const organizationId of createdOrganizationIds) {
        await cleanupTestRows(prisma, [
          ["roleBinding", { organizationId }],
          ["apiKey", { organizationId }],
          ["customRole", { organizationId }],
          ["promptTag", { organizationId }],
          ["team", { organizationId }],
          ["organization", { id: organizationId }],
        ]);
      }
    } finally {
      // The suite swapped the global app and the instance credential; leaving
      // either installed would cascade into every later suite of the run.
      await resetApp();
    }
  });

  describe("given a self-hosted deployment with the instance credential configured", () => {
    /** @scenario An instance administrator creates an organization with a bootstrap key */
    it("creates the organization and hands back an admin key that immediately manages it", async () => {
      const response = await provision({
        name: "Acme",
        slug: `prov-acme-${ns}`,
        adminApiKeyName: "Terraform bootstrap",
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.organization.id).toBeTruthy();
      expect(body.organization.name).toBe("Acme");
      expect(body.organization.slug).toBe(`prov-acme-${ns}`);
      expect(body.adminApiKey.id).toBeTruthy();
      expect(body.adminApiKey.token).toContain("sk-lw-");

      // The chain: the returned key manages the new organization through the
      // management API with no browser step in between.
      const managed = await organizationApp.request("/api/organization", {
        headers: { Authorization: `Bearer ${body.adminApiKey.token}` },
      });
      expect(managed.status).toBe(200);
      const organization = await managed.json();
      expect(organization.id).toBe(body.organization.id);
      expect(organization.slug).toBe(`prov-acme-${ns}`);
    });

    /** @scenario A slug outside the documented shape is refused */
    it("answers 422 for a slug that is not lowercase-and-hyphens, and writes nothing", async () => {
      const invalidSlug = `Prov_Invalid ${ns}`;

      const response = await provision({
        name: "Acme Invalid Slug",
        slug: invalidSlug,
      });

      expect(response.status).toBe(422);
      expect(
        await prisma.organization.count({
          where: { name: "Acme Invalid Slug" },
        }),
      ).toBe(0);
    });

    /** @scenario A duplicate organization slug is refused */
    it("answers organization_slug_taken and creates no second organization", async () => {
      const first = await provision({
        name: "Acme Duplicate",
        slug: `prov-dup-${ns}`,
      });
      expect(first.status).toBe(201);

      const second = await provision({
        name: "Acme Duplicate Again",
        slug: `prov-dup-${ns}`,
      });

      expect(second.status).toBe(409);
      // The SecuredApp legacy envelope carries the stable code in `error`.
      const body = await second.json();
      expect(body.error).toBe("organization_slug_taken");
      expect(
        await prisma.organization.count({
          where: { slug: `prov-dup-${ns}` },
        }),
      ).toBe(1);
    });

    /** @scenario A failed bootstrap key leaves no organization behind */
    it("compensates a failed key mint so the slug frees up for the retry", async () => {
      // "Langy session" is a reserved system key name, so the bootstrap key
      // mint fails after the organization row exists: exactly the partial
      // failure the compensation is for, forced with no mocks.
      const failed = await provision({
        name: "Acme Compensated",
        slug: `prov-comp-${ns}`,
        adminApiKeyName: "Langy session",
      });

      expect(failed.status).toBeGreaterThanOrEqual(400);
      expect(
        await prisma.organization.count({
          where: { slug: `prov-comp-${ns}` },
        }),
      ).toBe(0);

      const retried = await provision({
        name: "Acme Compensated",
        slug: `prov-comp-${ns}`,
      });
      expect(retried.status).toBe(201);
      expect((await retried.clone().json()).organization.slug).toBe(
        `prov-comp-${ns}`,
      );
    });

    /** @scenario Listing organizations requires the instance key */
    it("refuses an unauthenticated list and returns the organizations to the credential", async () => {
      const orgA = await (
        await provision({ name: "List A", slug: `prov-list-a-${ns}` })
      ).json();
      const orgB = await (
        await provision({ name: "List B", slug: `prov-list-b-${ns}` })
      ).json();

      const unauthenticated = await app.request("/api/organizations");
      expect(unauthenticated.status).toBe(401);

      const wrongKey = await app.request("/api/organizations", {
        headers: { Authorization: `Bearer not-the-instance-key-${ns}` },
      });
      expect(wrongKey.status).toBe(401);

      const response = await app.request("/api/organizations", {
        headers: instanceHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      const ids = body.organizations.map(
        (organization: { id: string }) => organization.id,
      );
      expect(ids).toEqual(
        expect.arrayContaining([orgA.organization.id, orgB.organization.id]),
      );

      const byId = await app.request(
        `/api/organizations/${orgA.organization.id}`,
        { headers: instanceHeaders() },
      );
      expect(byId.status).toBe(200);
      expect((await byId.json()).organization).toMatchObject({
        id: orgA.organization.id,
        slug: `prov-list-a-${ns}`,
      });
    });

    /** @scenario Fetching a provisioned organization returns what creation reported */
    it("reads back the id, name and slug creation returned", async () => {
      const created = await (
        await provision({ name: "Read Back", slug: `prov-read-${ns}` })
      ).json();

      const response = await app.request(
        `/api/organizations/${created.organization.id}`,
        { headers: instanceHeaders() },
      );

      expect(response.status).toBe(200);
      expect((await response.json()).organization).toMatchObject({
        id: created.organization.id,
        name: "Read Back",
        slug: `prov-read-${ns}`,
      });
    });

    /** @scenario Fetching an unknown organization id is not found */
    it("answers 404 for an id that names no organization", async () => {
      const response = await app.request(
        `/api/organizations/org_missing-${ns}`,
        { headers: instanceHeaders() },
      );

      expect(response.status).toBe(404);
    });
  });

  describe("given no instance credential is configured", () => {
    /** @scenario Organization provisioning is absent without an instance key */
    it("answers 404: the family does not exist", async () => {
      delete process.env.LANGWATCH_INSTANCE_ADMIN_API_KEY;

      const response = await app.request("/api/organizations", {
        method: "POST",
        headers: instanceHeaders(),
        body: JSON.stringify({ name: "Ghost", slug: `prov-ghost-${ns}` }),
      });

      expect(response.status).toBe(404);
      expect(
        await prisma.organization.findFirst({
          where: { slug: `prov-ghost-${ns}` },
        }),
      ).toBeNull();
    });
  });

  describe("given a cloud deployment", () => {
    /** @scenario Organization provisioning is absent on cloud deployments */
    it("answers 404 even with the credential configured", async () => {
      globalForApp.__langwatch_app = createTestApp({
        planProvider: PlanProviderService.create({
          getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
        }),
        config: {
          nodeEnv: "test",
          databaseUrl: "postgresql://test@localhost/test",
          isSaas: true,
        },
      });

      const response = await app.request("/api/organizations", {
        method: "POST",
        headers: instanceHeaders(),
        body: JSON.stringify({ name: "Cloudy", slug: `prov-cloud-${ns}` }),
      });

      expect(response.status).toBe(404);
      expect(
        await prisma.organization.findFirst({
          where: { slug: `prov-cloud-${ns}` },
        }),
      ).toBeNull();
    });
  });
});

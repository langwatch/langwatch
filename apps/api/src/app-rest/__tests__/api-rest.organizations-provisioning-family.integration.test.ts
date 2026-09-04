/**
 * @vitest-environment node
 *
 * The organization provisioning family, mounted the way this process mounts
 * it, over an in-memory instance directory.
 *
 * This is the one surface that exists before any organization does, so the
 * things worth pinning are the ones the FAMILY owns rather than the ones a
 * database owns: the slug shape it refuses, the deterministic 409 on a taken
 * slug, the compensating teardown when the bootstrap key cannot be minted,
 * the two distinct credential refusals, and the per-request availability that
 * answers 404 rather than 403 on cloud or with no instance key configured.
 * The directory and the credential store are in memory because they are the
 * datastore's half; everything above them is the real mount.
 *
 * @see specs/organizations/organizations-provisioning-rest-api.feature
 */
import { HIDDEN_SYSTEM_KEY_NAMES } from "@langwatch/api-key-contract";
import type { ApiKey, ApiKeyService, CreateApiKeyInput } from "@langwatch/api-key-contract";
import {
  OrganizationSlugTakenError,
  type OrganizationProvisioningPort,
  type OrganizationProvisioningSummary,
} from "@langwatch/organization-server";
import { describe, expect, it } from "vitest";

import {
  absenceRecorder,
  errorCodeOf,
  mountRestFamily,
  type MountedRestFamily,
} from "./support/rest-family.harness";

const INSTANCE_KEY = "instance-key";
const instanceHeaders = { authorization: `Bearer ${INSTANCE_KEY}` };

type CreatedOrganization = {
  organization: { id: string; name: string; slug: string };
  adminApiKey: { id: string; token: string };
};

describe("given a self-hosted deployment with the instance credential configured", () => {
  describe("when an instance administrator provisions an organization", () => {
    // @scenario "An instance administrator creates an organization with a bootstrap key"
    it("returns the organization and an admin key bound ADMIN over it", async () => {
      const { api, keys } = mountProvisioning();

      const response = await api.post(
        "/api/v1/organizations",
        { name: "Acme", slug: "acme", adminApiKeyName: "Terraform bootstrap" },
        instanceHeaders,
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as CreatedOrganization;
      expect(body.organization.id).toBeTruthy();
      expect(body.organization.name).toBe("Acme");
      expect(body.organization.slug).toBe("acme");
      expect(body.adminApiKey.id).toBeTruthy();
      expect(body.adminApiKey.token).toContain("sk-lw-");

      // The chain the family exists for: the token it handed back resolves to
      // the organization it just made, holding ADMIN over it, with no browser
      // step in between.
      const verified = await keys.tryVerify({ token: body.adminApiKey.token });
      expect(verified?.organizationId).toBe(body.organization.id);
      expect(verified?.roleBindings).toContainEqual(
        expect.objectContaining({
          role: "ADMIN",
          scopeType: "ORGANIZATION",
          scopeId: body.organization.id,
        }),
      );
      expect(keys.minted[0]?.name).toBe("Terraform bootstrap");
    });
  });

  describe("when the slug is not lowercase letters, digits and hyphens", () => {
    // @scenario "A slug outside the documented shape is refused"
    it("answers 422 and writes no organization", async () => {
      const { api, directory } = mountProvisioning();

      const response = await api.post(
        "/api/v1/organizations",
        { name: "Acme Invalid Slug", slug: "Acme_Invalid Slug" },
        instanceHeaders,
      );

      expect(response.status).toBe(422);
      expect(directory.all()).toHaveLength(0);
    });
  });

  describe("when the slug is already claimed on the instance", () => {
    // @scenario "A duplicate organization slug is refused"
    it("answers organization_slug_taken with 409 and creates no second organization", async () => {
      const { api, directory } = mountProvisioning();
      const first = await api.post(
        "/api/v1/organizations",
        { name: "Acme Duplicate", slug: "acme-duplicate" },
        instanceHeaders,
      );
      expect(first.status).toBe(201);

      const second = await api.post(
        "/api/v1/organizations",
        { name: "Acme Duplicate Again", slug: "acme-duplicate" },
        instanceHeaders,
      );

      expect(second.status).toBe(409);
      await expect(errorCodeOf(second)).resolves.toBe("organization_slug_taken");
      expect(directory.all().filter((row) => row.slug === "acme-duplicate")).toHaveLength(1);
    });
  });

  describe("when the bootstrap key cannot be minted", () => {
    // @scenario "A failed bootstrap key leaves no organization behind"
    it("compensates the committed organization so the slug provisions on the retry", async () => {
      const { api, directory } = mountProvisioning();

      // A reserved system key name is refused by the credential store, so the
      // mint fails AFTER the organization row exists: exactly the partial
      // failure the compensation is there for.
      const failed = await api.post(
        "/api/v1/organizations",
        { name: "Acme Compensated", slug: "acme-comp", adminApiKeyName: HIDDEN_SYSTEM_KEY_NAMES[0] },
        instanceHeaders,
      );

      expect(failed.status).toBeGreaterThanOrEqual(400);
      expect(directory.all().filter((row) => row.slug === "acme-comp")).toHaveLength(0);

      const retried = await api.post(
        "/api/v1/organizations",
        { name: "Acme Compensated", slug: "acme-comp" },
        instanceHeaders,
      );
      expect(retried.status).toBe(201);
      const body = (await retried.json()) as CreatedOrganization;
      expect(body.organization.slug).toBe("acme-comp");
    });
  });

  describe("when the roster is read with and without the instance credential", () => {
    // @scenario "Listing organizations requires the instance key"
    it("names missing_credentials and invalid_credentials apart, and lists both to the key", async () => {
      const { api } = mountProvisioning();
      const first = (await (
        await api.post("/api/v1/organizations", { name: "List A", slug: "list-a" }, instanceHeaders)
      ).json()) as CreatedOrganization;
      const second = (await (
        await api.post("/api/v1/organizations", { name: "List B", slug: "list-b" }, instanceHeaders)
      ).json()) as CreatedOrganization;

      // Two codes on purpose: nothing presented is a configuration mistake the
      // caller fixes from the message, a wrong value is a credential that is
      // not this instance's.
      const unauthenticated = await api.get("/api/v1/organizations");
      expect(unauthenticated.status).toBe(401);
      await expect(errorCodeOf(unauthenticated)).resolves.toBe("missing_credentials");

      const wrongKey = await api.get("/api/v1/organizations", {
        authorization: "Bearer not-the-instance-key",
      });
      expect(wrongKey.status).toBe(401);
      await expect(errorCodeOf(wrongKey)).resolves.toBe("invalid_credentials");

      const listed = await api.get("/api/v1/organizations", instanceHeaders);
      expect(listed.status).toBe(200);
      const body = (await listed.json()) as { organizations: Array<{ id: string }> };
      expect(body.organizations.map((organization) => organization.id)).toEqual(
        expect.arrayContaining([first.organization.id, second.organization.id]),
      );
    });
  });

  describe("when a provisioned organization is fetched by the id creation returned", () => {
    // @scenario "Fetching a provisioned organization returns what creation reported"
    it("reads back the same id, name and slug", async () => {
      const { api } = mountProvisioning();
      const created = (await (
        await api.post(
          "/api/v1/organizations",
          { name: "Read Back", slug: "read-back" },
          instanceHeaders,
        )
      ).json()) as CreatedOrganization;

      const response = await api.get(
        `/api/v1/organizations/${created.organization.id}`,
        instanceHeaders,
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { organization: Record<string, unknown> };
      expect(body.organization).toMatchObject({
        id: created.organization.id,
        name: "Read Back",
        slug: "read-back",
      });
    });
  });

  describe("when an id that names no organization is fetched", () => {
    // @scenario "Fetching an unknown organization id is not found"
    it("answers 404", async () => {
      const { api } = mountProvisioning();

      const response = await api.get("/api/v1/organizations/organization_missing", instanceHeaders);

      expect(response.status).toBe(404);
    });
  });

  describe("when the family is addressed without its version segment", () => {
    it("answers the bare alias identically to the dated path", async () => {
      const { api } = mountProvisioning();
      await api.post("/api/v1/organizations", { name: "Alias", slug: "alias" }, instanceHeaders);

      const dated = await api.get("/api/v1/organizations", instanceHeaders);
      const bare = await api.get("/api/organizations", instanceHeaders);

      expect(bare.status).toBe(dated.status);
      await expect(bare.json()).resolves.toEqual(await dated.json());
    });
  });
});

describe("given no instance administrator credential is configured", () => {
  describe("when an organization is provisioned", () => {
    // @scenario "Organization provisioning is absent without an instance key"
    it("answers 404 from a family that is mounted but does not exist for this deployment", async () => {
      const absence = absenceRecorder();
      const { api, directory } = mountProvisioning({
        packagedPorts: { instanceAdminKey: () => undefined },
        absence: absence.report,
      });

      const response = await api.post(
        "/api/v1/organizations",
        { name: "Ghost", slug: "ghost" },
        instanceHeaders,
      );

      expect(response.status).toBe(404);
      expect(directory.all()).toHaveLength(0);
      // Availability is per request, not per mount: the routes stay registered
      // so the policy registry and the router can never disagree about them.
      expect(absence.absent).not.toContain("organizations");
      expect(api.claims("/api/v1/organizations")).toBe(true);
    });
  });
});

describe("given a cloud deployment with an instance administrator credential configured", () => {
  describe("when an organization is provisioned", () => {
    // @scenario "Organization provisioning is absent on cloud deployments"
    it("answers 404 even though the credential is set", async () => {
      const { api, directory } = mountProvisioning({ packagedPorts: { isSaas: () => true } });

      const response = await api.post(
        "/api/v1/organizations",
        { name: "Cloudy", slug: "cloudy" },
        instanceHeaders,
      );

      expect(response.status).toBe(404);
      expect(directory.all()).toHaveLength(0);
    });
  });
});

/** The instance's organization roster, holding the slug as its natural key. */
function inMemoryDirectory() {
  const rows: OrganizationProvisioningSummary[] = [];

  const implemented: OrganizationProvisioningPort & { all(): OrganizationProvisioningSummary[] } = {
    all: () => rows,
    createForProvisioning: async ({ name, slug }) => {
      const claimed = slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (rows.some((row) => row.slug === claimed)) throw new OrganizationSlugTakenError(claimed);
      const organization = {
        id: `organization_${rows.length + 1}`,
        name,
        slug: claimed,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      };
      rows.push(organization);
      return { organization, team: { id: `team_${organization.id}`, name: "Default" } };
    },
    listProvisioningSummaries: async () => [...rows],
    getProvisioningSummary: async (organizationId) =>
      rows.find((row) => row.id === organizationId) ?? null,
    deleteProvisionedOrganization: async ({ organizationId }) => {
      const index = rows.findIndex((row) => row.id === organizationId);
      if (index >= 0) rows.splice(index, 1);
    },
  };

  return namedAbsences(implemented, "organization directory");
}

/** The credential store, refusing the names reserved for platform-minted keys. */
function inMemoryApiKeys() {
  const stored = new Map<string, ApiKey>();
  const minted: CreateApiKeyInput[] = [];

  const implemented = {
    minted,
    create: async (input: CreateApiKeyInput) => {
      if (HIDDEN_SYSTEM_KEY_NAMES.includes(input.name)) {
        throw new Error(`"${input.name}" is reserved for credentials LangWatch manages itself`);
      }
      minted.push(input);
      const token = `sk-lw-${stored.size + 1}`;
      const apiKey = {
        id: `apikey_${stored.size + 1}`,
        name: input.name,
        description: null,
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        createdByUserId: input.createdByUserId ?? null,
        createdByDeviceLabel: null,
        lookupId: token,
        permissionMode: input.permissionMode ?? "all",
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        ingestSourceType: null,
        ingestionTemplateId: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        roleBindings: input.bindings.map((binding, index) => ({
          id: `binding_${stored.size + 1}_${index}`,
          role: binding.role,
          scopeType: binding.scopeType,
          scopeId: binding.scopeId,
          customRoleId: binding.customRoleId ?? null,
        })),
      } satisfies ApiKey;
      stored.set(token, apiKey);
      return { token, apiKey };
    },
    tryVerify: async ({ token }: { token: string }) => {
      const apiKey = stored.get(token);
      return apiKey ? { ...apiKey, tokenType: "apiKey" as const } : null;
    },
  };

  return namedAbsences(implemented, "credential store");
}

/**
 * Anything this suite does not compose fails saying so, rather than answering
 * emptily and letting an assertion pass for the wrong reason.
 */
function namedAbsences<T extends object>(implemented: T, subject: string): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (value !== undefined) return value;
      return () => {
        throw new Error(`This suite composes no ${subject} ${String(property)}`);
      };
    },
  });
}

function mountProvisioning(
  options: Omit<Parameters<typeof mountRestFamily>[0], "packaged"> = {},
): {
  api: MountedRestFamily;
  directory: ReturnType<typeof inMemoryDirectory>;
  keys: ReturnType<typeof inMemoryApiKeys>;
} {
  const directory = inMemoryDirectory();
  const keys = inMemoryApiKeys();
  const api = mountRestFamily({
    ...options,
    packaged: {
      organizationProvisioning: () => directory as never,
      apiKeys: () => keys as unknown as ApiKeyService,
    },
  });
  return { api, directory, keys };
}

/**
 * @see specs/private-dataplane/clickhouse-routing.feature
 * The one directory both the API process and the worker process compose: which
 * organization a tenant routes by, for all three kinds of tenant.
 */
import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";
import { SCHEDULED_SINGLETON_PROJECT_ID } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  type PrivateTenantRows,
  prismaTenantDirectory,
  privateTenantListing,
  type TenantDirectoryRows,
} from "../tenant-directory.ts";

function directoryOver(world: {
  projects?: Record<string, string>;
  organizations?: string[];
  users?: string[];
}) {
  const asked: string[] = [];
  const rows: TenantDirectoryRows = {
    project: {
      findUnique: async ({ where }) => {
        asked.push(`project:${where.id}`);
        const organizationId = world.projects?.[where.id];
        return organizationId === undefined ? null : { team: { organizationId } };
      },
    },
    organization: {
      findUnique: async ({ where }) => {
        asked.push(`organization:${where.id}`);
        return (world.organizations ?? []).includes(where.id) ? { id: where.id } : null;
      },
    },
    user: {
      findUnique: async ({ where }) => {
        asked.push(`user:${where.id}`);
        return (world.users ?? []).includes(where.id) ? { id: where.id } : null;
      },
    },
  };
  return { asked, directory: prismaTenantDirectory(rows) };
}

describe("the tenant directory", () => {
  describe("given a tenant that names a project", () => {
    /** @scenario "One directory places tenants for every process" */
    it("answers the organization the project belongs to", async () => {
      const { directory } = directoryOver({ projects: { "project-1": "org-1" } });

      await expect(directory.organizationForTenant("project-1")).resolves.toBe("org-1");
    });
  });

  describe("given a tenant that names an organization", () => {
    /** @scenario "An organization is a tenant in its own right" */
    it("answers that organization, with no project needing to exist", async () => {
      const { directory } = directoryOver({ organizations: ["org-1"] });

      await expect(directory.organizationForTenant("org-1")).resolves.toBe("org-1");
    });
  });

  describe("given a tenant that names a user", () => {
    /** @scenario "A user is a tenant in its own right" */
    it("answers the platform tenant rather than resolving a membership", async () => {
      const { asked, directory } = directoryOver({ users: ["user-1"] });

      await expect(directory.organizationForTenant("user-1")).resolves.toBe(PLATFORM_TENANT);
      expect(asked).toEqual(["project:user-1", "organization:user-1", "user:user-1"]);
    });
  });

  describe("given a user who belongs to an organization with a private dataplane", () => {
    /** @scenario "A user in a private-dataplane organization still routes to shared" */
    it("still answers the platform tenant, consulting no membership", async () => {
      const { asked, directory } = directoryOver({
        organizations: ["org-private"],
        users: ["user-1"],
      });

      await expect(directory.organizationForTenant("user-1")).resolves.toBe(PLATFORM_TENANT);
      expect(asked).not.toContain("organization:org-private");
    });
  });

  describe("given the scheduled singleton's pseudo-tenant", () => {
    /** @scenario "A scheduled singleton is a tenant in its own right" */
    it("answers the platform tenant without looking anything up", async () => {
      const { asked, directory } = directoryOver({});

      await expect(directory.organizationForTenant(SCHEDULED_SINGLETON_PROJECT_ID)).resolves.toBe(
        PLATFORM_TENANT,
      );
      await expect(directory.organizationForTenant("platform")).resolves.toBe(PLATFORM_TENANT);
      expect(asked).toEqual([]);
    });
  });

  describe("given a tenant that names nothing at all", () => {
    /** @scenario "A tenant that names no project, organization or user is refused" */
    it("answers no organization rather than falling back to the shared instance", async () => {
      const { directory } = directoryOver({});

      await expect(directory.organizationForTenant("nobody")).resolves.toBeNull();
    });
  });
});

/** Projects by organisation, answering the listing's paged read; records each page's cursor. */
function projectRowsOver(projects: Record<string, string>) {
  const afters: (string | undefined)[] = [];
  const rows: PrivateTenantRows = {
    project: {
      findMany: async ({ where, take }) => {
        afters.push(where.id?.gt);
        return Object.entries(projects)
          .filter(([, org]) => where.team.organizationId.in.includes(org))
          .map(([id]) => id)
          .filter((id) => where.id === undefined || id > where.id.gt)
          .toSorted()
          .slice(0, take)
          .map((id) => ({ id }));
      },
    },
  };
  return { afters, rows };
}

async function listed(listing: (() => AsyncIterable<string>) | undefined): Promise<string[]> {
  const tenants: string[] = [];
  if (listing === undefined) return tenants;
  for await (const tenantId of listing()) tenants.push(tenantId);
  return tenants;
}

describe("the private tenant listing", () => {
  describe("given a privately routed organisation with more projects than one page", () => {
    /** @scenario "The tenant directory pages a privately routed organisation's tenants with a cursor" */
    it("lists the organisation and each project once, a page at a time after the last id", async () => {
      const { afters, rows } = projectRowsOver({
        "project-a": "org-private",
        "project-b": "org-private",
        "project-c": "org-private",
        "project-shared": "org-shared",
      });
      const listing = privateTenantListing({
        prisma: rows,
        organizationIds: ["org-private"],
        pageSize: 2,
      });

      expect(listing).toBeDefined();
      expect(await listed(listing)).toEqual(["org-private", "project-a", "project-b", "project-c"]);
      expect(afters).toEqual([undefined, "project-b"]);
    });
  });

  describe("given a process with no private route", () => {
    /** @scenario "A process with no private route lists only the shared log's tenants" */
    it("offers no listing and never asks Postgres", () => {
      const { afters, rows } = projectRowsOver({ "project-a": "org-shared" });

      expect(privateTenantListing({ prisma: rows, organizationIds: [] })).toBeUndefined();
      expect(afters).toEqual([]);
    });
  });
});

/**
 * @see specs/private-dataplane/clickhouse-routing.feature
 * The one directory both the API process and the worker process compose: which
 * organization a tenant routes by, for all three kinds of tenant.
 */
import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";
import { SCHEDULED_SINGLETON_PROJECT_ID } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { prismaTenantDirectory, type TenantDirectoryRows } from "../tenant-directory.ts";

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

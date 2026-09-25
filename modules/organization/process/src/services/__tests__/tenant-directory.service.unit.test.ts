/**
 * @see specs/private-dataplane/clickhouse-routing.feature
 * The one directory both the API process and the worker process compose: which
 * organization a tenant routes by, for all three kinds of tenant.
 */
import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { TenantDirectoryService, type TenantOwnershipReader } from "../tenant-directory.service.ts";

function directoryOver(world: {
  projects?: Record<string, string>;
  organizations?: string[];
  users?: string[];
}) {
  const asked: string[] = [];
  const reader: TenantOwnershipReader = {
    getProjectOrganizationId: async (tenantId) => {
      asked.push(`project:${tenantId}`);
      const organizationId = world.projects?.[tenantId];
      if (organizationId === undefined) throw new ProjectNotFoundError();
      return organizationId;
    },
    organizationExists: async (tenantId) => {
      asked.push(`organization:${tenantId}`);
      return (world.organizations ?? []).includes(tenantId);
    },
    userExists: async (tenantId) => {
      asked.push(`user:${tenantId}`);
      return (world.users ?? []).includes(tenantId);
    },
  };
  return { asked, directory: TenantDirectoryService.create(reader) };
}

describe("the tenant directory", () => {
  describe("given a tenant that names a project", () => {
    /** @scenario "One directory places tenants for every process" */
    it("answers the organization the project belongs to", async () => {
      const { directory } = directoryOver({ projects: { "project-1": "org-1" } });

      await expect(directory.getTenantPlacement("project-1")).resolves.toEqual({
        kind: "placed",
        organizationId: "org-1",
      });
    });
  });

  describe("given a tenant that names an organization", () => {
    /** @scenario "An organization is a tenant in its own right" */
    it("answers that organization, with no project needing to exist", async () => {
      const { directory } = directoryOver({ organizations: ["org-1"] });

      await expect(directory.getTenantPlacement("org-1")).resolves.toEqual({
        kind: "placed",
        organizationId: "org-1",
      });
    });
  });

  describe("given a tenant that names a user", () => {
    /** @scenario "A user is a tenant in its own right" */
    it("answers the platform tenant rather than resolving a membership", async () => {
      const { asked, directory } = directoryOver({ users: ["user-1"] });

      await expect(directory.getTenantPlacement("user-1")).resolves.toEqual({
        kind: "placed",
        organizationId: PLATFORM_TENANT,
      });
      expect(asked).toEqual(["project:user-1", "organization:user-1", "user:user-1"]);
    });
  });

  describe("given a user who belongs to an organization with a private dataplane", () => {
    /** @scenario "A user in a private-dataplane organization still routes to shared" */
    it("still answers the platform tenant, consulting no membership", async () => {
      // The membership exists, and the directory has no way to reach it: what
      // is read is the user row, never the organizations they belong to.
      const { asked, directory } = directoryOver({
        organizations: ["org-private"],
        users: ["user-1"],
      });

      await expect(directory.getTenantPlacement("user-1")).resolves.toEqual({
        kind: "placed",
        organizationId: PLATFORM_TENANT,
      });
      expect(asked).not.toContain("organization:org-private");
    });
  });

  describe("given a tenant that names nothing at all", () => {
    /** @scenario "A tenant that names no project, organization or user is refused" */
    it("answers unplaced rather than falling back to the shared instance", async () => {
      const { directory } = directoryOver({});

      await expect(directory.getTenantPlacement("nobody")).resolves.toEqual({ kind: "unplaced" });
    });
  });
});

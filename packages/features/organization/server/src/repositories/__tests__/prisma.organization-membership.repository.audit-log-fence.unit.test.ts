/**
 * The organization fence on the audit trail.
 */

import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaOrganizationMembershipRepository } from "../prisma/prisma.organization-membership.repository";

const organizationUserFindMany = vi.fn();
const projectFindMany = vi.fn();
const auditLogFindMany = vi.fn();
const auditLogCount = vi.fn();
const userFindMany = vi.fn();

const prisma = {
  organizationUser: { findMany: organizationUserFindMany },
  project: { findMany: projectFindMany },
  auditLog: { findMany: auditLogFindMany, count: auditLogCount },
  user: { findMany: userFindMany },
} as unknown as PrismaClient;

const writer = {} as unknown as AuthzGrantsService;

let repository: PrismaOrganizationMembershipRepository;

beforeEach(() => {
  vi.clearAllMocks();
  organizationUserFindMany.mockResolvedValue([{ userId: "user_shared" }]);
  projectFindMany.mockResolvedValue([{ id: "project_acme" }]);
  auditLogFindMany.mockResolvedValue([]);
  auditLogCount.mockResolvedValue(0);
  userFindMany.mockResolvedValue([]);
  repository = PrismaOrganizationMembershipRepository.create({ database: prisma, grants: writer });
});

/** Every predicate the built query carries, flattened out of its AND / OR tree. */
function predicatesOf(where: unknown): unknown[] {
  if (!where || typeof where !== "object") return [];
  const node = where as Record<string, unknown>;
  const children = [
    ...((node.AND as unknown[] | undefined) ?? []),
    ...((node.OR as unknown[] | undefined) ?? []),
  ];
  return [node, ...children.flatMap((child) => predicatesOf(child))];
}

describe("given an organization's audit trail", () => {
  describe("when a member of it also belongs to another organization", () => {
    /** @scenario "Project rows are fenced to the organization's own projects" */
    it("matches project rows against this organization's projects, never against any project at all", async () => {
      await repository.getAuditLogs({
        organizationId: "org_acme",
        pageOffset: 0,
        pageSize: 25,
      });

      expect(projectFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { team: { organizationId: "org_acme" } } }),
      );
      const where = auditLogFindMany.mock.calls[0]![0].where;
      const predicates = predicatesOf(where);
      expect(predicates).toContainEqual(
        expect.objectContaining({
          organizationId: null,
          projectId: { in: ["project_acme"] },
        }),
      );
      expect(predicates).not.toContainEqual(expect.objectContaining({ projectId: { not: null } }));
    });
  });

  describe("when the filter names a project of another organization", () => {
    /** @scenario "A project filter naming another organization's project returns nothing" */
    it("returns nothing and never reads the audit table", async () => {
      await expect(
        repository.getAuditLogs({
          organizationId: "org_acme",
          projectId: "project_bravo",
          pageOffset: 0,
          pageSize: 25,
        }),
      ).resolves.toEqual({ auditLogs: [], totalCount: 0 });

      expect(auditLogFindMany).not.toHaveBeenCalled();
      expect(auditLogCount).not.toHaveBeenCalled();
    });
  });
});

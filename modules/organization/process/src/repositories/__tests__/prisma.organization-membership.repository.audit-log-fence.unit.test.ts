/**
 * The organization fence on the audit trail.
 */

import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaOrganizationMembershipRepository } from "../prisma/prisma.organization-membership.repository.ts";

const organizationUserFindMany = vi.fn();
const projectFindMany = vi.fn();
const auditLogFindMany = vi.fn();
const auditLogCount = vi.fn();
const userFindMany = vi.fn();

const prisma = prismaDouble({
  organizationUser: { findMany: organizationUserFindMany },
  project: { findMany: projectFindMany },
  auditLog: { findMany: auditLogFindMany, count: auditLogCount },
  user: { findMany: userFindMany },
});

const writer = createApiFixture<AuthzGrantsService>();

let repository: PrismaOrganizationMembershipRepository;

beforeEach(() => {
  vi.clearAllMocks();
  organizationUserFindMany.mockResolvedValue([{ userId: "user_shared" }]);
  projectFindMany.mockResolvedValue([{ id: "project_acme" }]);
  auditLogFindMany.mockResolvedValue([]);
  auditLogCount.mockResolvedValue(0);
  userFindMany.mockResolvedValue([]);
  repository = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    grants: writer,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
  });
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

describe("given an audit row written under an impersonation", () => {
  const stored = {
    id: "audit_1",
    createdAt: new Date("2026-10-10T09:00:00.000Z"),
    userId: "user_alice",
    projectId: null,
    organizationId: "org_acme",
    action: "organization.member.add",
    args: null,
    error: null,
    ipAddress: "198.51.100.12",
    userAgent: null,
    targetKind: null,
    targetId: null,
    before: null,
    after: null,
  };

  beforeEach(() => {
    userFindMany.mockResolvedValue([
      { id: "user_alice", name: "Alice", email: "alice@acme.test" },
      { id: "user_operator", name: "Operator", email: "op@langwatch.test" },
    ]);
  });

  /** @scenario An impersonated entry names the operator as well as the person */
  it.each([
    ["the stored column", { actorUserId: "user_operator", metadata: null }],
    [
      "the tRPC door's metadata",
      { actorUserId: null, metadata: { impersonatorId: "user_operator" } },
    ],
  ])("names the operator read from %s", async (_source, impersonation) => {
    auditLogFindMany.mockResolvedValue([{ ...stored, ...impersonation }]);
    auditLogCount.mockResolvedValue(1);

    const { auditLogs } = await repository.getAuditLogs({
      organizationId: "org_acme",
      pageOffset: 0,
      pageSize: 25,
    });

    expect(auditLogs[0]).toMatchObject({
      actorUserId: "user_operator",
      actorUser: { id: "user_operator", name: "Operator", email: "op@langwatch.test" },
      user: { id: "user_alice" },
    });
  });
});

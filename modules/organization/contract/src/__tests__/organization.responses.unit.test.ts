import { describe, expect, it } from "vitest";

import {
  organizationAuditLogPageSchema,
  organizationInviteAcceptedSchema,
  organizationMemberDirectorySchema,
  organizationMemberRecordSchema,
  organizationUserRowsSchema,
} from "../organization.responses.ts";

describe("organizationAuditLogPageSchema", () => {
  /** @scenario "An audit log entry declares the before and after states main served" */
  it("accepts an entry carrying before and after states", () => {
    const page = {
      totalCount: 1,
      auditLogs: [
        {
          id: "audit_1",
          createdAt: new Date("2026-09-30T00:00:00.000Z"),
          userId: "user_1",
          organizationId: "organization_1",
          projectId: null,
          action: "gateway.budget.update",
          payload: { limit: 2 },
          ipAddress: null,
          userAgent: null,
          error: null,
          args: { before: { limit: 1 }, after: { limit: 2 } },
          user: null,
          project: null,
          source: "gateway",
          targetKind: "budget",
          targetId: "budget_1",
          before: { limit: 1 },
          after: { limit: 2 },
        },
      ],
    };

    expect(organizationAuditLogPageSchema.validate(page)).toBe(true);
  });
});

describe("organizationMemberDirectorySchema", () => {
  /** @scenario "The organization members read returns only the fields the directory shows" */
  it("drops every field the directory does not show", () => {
    const at = new Date("2026-09-30T00:00:00.000Z");
    const stored = {
      id: "organization_1",
      name: "Acme",
      s3SecretAccessKey: "stored-secret",
      license: "stored-licence",
      stripeCustomerId: "customer_1",
      members: [
        {
          userId: "user_1",
          organizationId: "organization_1",
          role: "MEMBER",
          createdAt: at,
          updatedAt: at,
          departmentId: null,
          disabledAt: null,
          user: {
            id: "user_1",
            name: "Ada",
            email: "ada@example.com",
            image: null,
            deactivatedAt: null,
            userHashKey: "stored-hash",
            lastHomePath: "/home",
            tracesExplorerTourDismissedAt: at,
          },
          teamMemberships: [{ teamId: "team_1", team: { name: "Core" } }],
        },
      ],
    };

    const read = organizationMemberDirectorySchema.parse(stored);

    expect(Object.keys(read).toSorted()).toEqual(["id", "members", "name"]);
    expect(Object.keys(read.members[0]?.user ?? {}).toSorted()).toEqual([
      "deactivatedAt",
      "email",
      "id",
      "image",
      "name",
    ]);
    expect(read.members[0]).not.toHaveProperty("teamMemberships");
  });
});

describe("organizationUserRowsSchema", () => {
  /** @scenario "The flat organization members read returns only the fields the pickers show" */
  it("drops every user field the pickers do not show", () => {
    const at = new Date("2026-09-30T00:00:00.000Z");
    const [read] = organizationUserRowsSchema.parse([
      {
        id: "user_1",
        name: "Ada",
        email: "ada@example.com",
        deactivatedAt: null,
        userHashKey: "stored-hash",
        lastLoginAt: at,
        lastHomePath: "/home",
        tracesExplorerTourDismissedAt: at,
      },
    ]);

    expect(Object.keys(read ?? {}).toSorted()).toEqual(["deactivatedAt", "email", "id", "name"]);
  });
});

describe("organizationInviteAcceptedSchema", () => {
  /** @scenario "Accepting an invitation returns only what the accepting browser uses" */
  it("carries the organization's id and name and the project, and nothing else", () => {
    const read = organizationInviteAcceptedSchema.parse({
      success: true,
      invite: {
        id: "invite_1",
        inviteCode: "stored-code",
        organization: {
          id: "organization_1",
          name: "Acme",
          s3SecretAccessKey: "stored-secret",
          license: "stored-licence",
          stripeCustomerId: "customer_1",
        },
      },
      project: { slug: "chat" },
    });

    expect(read).toEqual({
      success: true,
      invite: { organization: { id: "organization_1", name: "Acme" } },
      project: { slug: "chat" },
    });
  });
});

describe("organizationMemberRecordSchema", () => {
  /** @scenario "One member's read returns the seat and the fields the person drawer shows" */
  it("drops the hash key and the team memberships", () => {
    const at = new Date("2026-09-30T00:00:00.000Z");
    const read = organizationMemberRecordSchema.parse({
      userId: "user_1",
      organizationId: "organization_1",
      role: "MEMBER",
      createdAt: at,
      updatedAt: at,
      departmentId: null,
      disabledAt: null,
      user: {
        id: "user_1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        emailVerified: true,
        deactivatedAt: null,
        userHashKey: "stored-hash",
        lastLoginAt: at,
      },
      teamMemberships: [{ teamId: "team_1", team: { name: "Core" } }],
    });

    expect(Object.keys(read.user).toSorted()).toEqual([
      "deactivatedAt",
      "email",
      "emailVerified",
      "id",
      "image",
      "name",
    ]);
    expect(read).not.toHaveProperty("teamMemberships");
  });
});

/**
 * @vitest-environment node
 *
 * Guards the bargain #8097 struck on the tRPC ingestion-key surface.
 *
 * `install` and `rotate` dispatched their audit write with `void
 * auditLog(...)`, so the row was not durable when the mutation answered.
 * They now await it — but the `.catch` stays, because the response shows the
 * plaintext token exactly once and an audit write that genuinely fails must
 * not swallow it. Awaiting without the catch would turn a lost audit row
 * into a lost credential, which is the worse half of the trade.
 *
 * These cases pin that second half: with the audit write rejecting, the
 * mutation still returns its token. They do NOT prove the ordering fix — a
 * DB-visibility assertion cannot see it here, because the tRPC audit
 * middleware awaits a write of its own after the handler returns, which
 * hides the race at this boundary. The ordering regression is observed on
 * the MCP surface, where nothing sits behind the tool:
 * `src/mcp/__tests__/governance-tools.audit-uniform.integration.test.ts`.
 */

import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { prisma } from "~/server/db";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";

// Only the router's own rows fail. The tRPC middleware audits every mutation
// under its procedure path, and failing that too would test the middleware's
// error handling rather than this router's. `install` is separable by action
// alone (`ingestionKey.mint` vs the middleware's `ingestionKey.install`);
// `rotate` is not — the router's action and the procedure path are the same
// string, so the two rows are told apart by the `apiKeyId` only the router
// records.
const { failWhen } = vi.hoisted(() => ({
  failWhen: {
    current: null as
      | null
      | ((entry: { action: string; args?: any }) => boolean),
  },
}));

vi.mock("@ee/audit-log/auditLog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@ee/audit-log/auditLog")>();
  return {
    auditLog: async (entry: Parameters<typeof actual.auditLog>[0]) => {
      if (failWhen.current?.(entry)) {
        throw new Error(`audit write refused for ${entry.action}`);
      }
      return await actual.auditLog(entry);
    },
  };
});

wireDefaultTestApp();

const suffix = nanoid(8);
const ORG_ID = `org-ikaudit-${suffix}`;
const USER_ID = `usr-ikaudit-${suffix}`;
const TEAM_ID = `team-ikaudit-${suffix}`;
const TEMPLATE_ID = `tmpl-ikaudit-${suffix}`;
// A source no CLI wrapper covers — the only kind a mint with no session takes.
const SOURCE_TYPE = "claude_cowork";

function caller() {
  return appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: USER_ID }, expires: "1" } as any,
    }),
  );
}

describe("ingestionKey tRPC router — a failed audit write keeps the token", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `Ingestion Key Audit ${suffix}`,
        slug: `ikaudit-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `ikaudit-${suffix}@example.com`,
        name: "Ingestion Key Audit",
      },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: OrganizationUserRole.ADMIN,
      },
    });
    // Org-scoped RoleBinding is what `organization:view` resolves through;
    // the legacy OrganizationUser.role alone does not escalate.
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Ingestion Key Audit Team ${suffix}`,
        slug: `ikaudit-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.ingestionTemplate.create({
      data: {
        id: TEMPLATE_ID,
        organizationId: null,
        slug: `platform_cowork_ikaudit_${suffix}`,
        sourceType: SOURCE_TYPE,
        displayName: "Platform Cowork",
        iconAsset: "preset:claude_code",
        ottlRules: "",
        platformPublished: true,
        enabled: true,
      },
    });
    // The mint lands in the caller's personal workspace, which this service
    // allocates rather than the team above.
    await new PersonalWorkspaceService(prisma).ensure({
      userId: USER_ID,
      organizationId: ORG_ID,
    });
  });

  afterAll(() => {
    // Every row this file writes is namespaced by `suffix`, and the mint
    // allocates a personal workspace whose keys the tenancy guard will not
    // let a test delete by user. Same choice the sibling MCP audit test
    // makes: leave the namespaced rows in the disposable test database
    // rather than unpick a graph the product owns.
    failWhen.current = null;
  });

  describe("when the mint audit row cannot be written", () => {
    it("still returns the token install shows exactly once", async () => {
      failWhen.current = (entry) => entry.action === "ingestionKey.mint";
      try {
        const issued = await caller().ingestionKey.install({
          organizationId: ORG_ID,
          sourceType: SOURCE_TYPE,
          templateId: TEMPLATE_ID,
        });
        expect(issued.token).toMatch(/^ik-lw-/);
        expect(issued.apiKeyId).toBeTruthy();
      } finally {
        failWhen.current = null;
      }
    });
  });

  describe("when the rotate audit row cannot be written", () => {
    it("still returns the replacement token", async () => {
      failWhen.current = (entry) =>
        entry.action === "ingestionKey.rotate" &&
        typeof entry.args?.apiKeyId === "string";
      try {
        const rotated = await caller().ingestionKey.rotate({
          organizationId: ORG_ID,
          sourceType: SOURCE_TYPE,
          templateId: TEMPLATE_ID,
        });
        expect(rotated.token).toMatch(/^ik-lw-/);
        expect(rotated.apiKeyId).toBeTruthy();
      } finally {
        failWhen.current = null;
      }
    });
  });
});

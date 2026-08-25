/**
 * @vitest-environment node
 *
 * The three access boundaries around a virtual key's trace destination
 * and drawer-managed budget, through the real tRPC router against real
 * Postgres.
 *
 * 1. The trace destination grants NOTHING: an org-owned key stores its
 *    destination in `traceProjectId`, never as a scope row, so a person
 *    who administers only that project cannot see, update, rotate or
 *    revoke the key.
 * 2. `applicableBudgets` is authorized, not just tenancy-checked: a
 *    plain org member without virtualKeys:manage on the draft scopes is
 *    refused before any budget data is read, and an existing key's
 *    budgets are only readable by callers who can see the key.
 * 3. Clearing the drawer's budget field archives exactly the budget the
 *    drawer manages; an independently created key-targeted cap survives
 *    with its own lifecycle and permission boundary.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { prisma } from "~/server/db";
import {
  getTestClickHouseClient,
  startTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  clearClickHouseTestApp,
  installClickHouseTestApp,
} from "~/test-utils/clickhouseTestApp";
import { traceProjectFor } from "../scopeResolver";

const suffix = nanoid(8)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "x");
const ORG_ID = `org-vkab-${suffix}`;
const TEAM_OWNER_ID = `team-vkab-owner-${suffix}`;
const TEAM_OTHER_ID = `team-vkab-other-${suffix}`;
const PROJECT_TRACE_ID = `proj-vkab-trace-${suffix}`;
const PROJECT_OTHER_ID = `proj-vkab-other-${suffix}`;
const ADMIN_ID = `usr-vkab-admin-${suffix}`;
const TRACE_ADMIN_ID = `usr-vkab-traceadmin-${suffix}`;
const PLAIN_ID = `usr-vkab-plain-${suffix}`;

function callerFor(userId: string) {
  return appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: userId }, expires: "1" },
    }),
  );
}

describe("virtual key access boundaries (real PG)", () => {
  let keyId: string;

  beforeAll(async () => {
    await startTestContainers();
    // The routes and workers under test take their ClickHouse repositories
    // from the App rather than resolving a client, so the fixture has to
    // provide one or they fail with "App not initialized".
    installClickHouseTestApp({
      resolveClient: async () => getTestClickHouseClient(),
    });
    await prisma.organization.create({
      data: { id: ORG_ID, name: `VKAB ${suffix}`, slug: `vkab-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_OWNER_ID,
        name: "owner-team",
        slug: `vkab-owner-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_OTHER_ID,
        name: "other-team",
        slug: `vkab-other-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_TRACE_ID,
        name: "trace-landing",
        slug: `vkab-trace-${suffix}`,
        teamId: TEAM_OWNER_ID,
        apiKey: `key-vkab-${suffix}`,
        language: "en",
        framework: "openai",
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_OTHER_ID,
        name: "sibling-private",
        slug: `vkab-other-${suffix}`,
        teamId: TEAM_OTHER_ID,
        apiKey: `key-vkab-other-${suffix}`,
        language: "en",
        framework: "openai",
      },
    });
    for (const [id, email] of [
      [ADMIN_ID, `vkab-admin-${suffix}@example.test`],
      [TRACE_ADMIN_ID, `vkab-trace-${suffix}@example.test`],
      [PLAIN_ID, `vkab-plain-${suffix}@example.test`],
    ] as const) {
      await prisma.user.create({ data: { id, email, name: id } });
    }
    await prisma.organizationUser.create({
      data: { userId: ADMIN_ID, organizationId: ORG_ID, role: "ADMIN" },
    });
    // OrgUser.role=ADMIN alone grants nothing beyond the MEMBER floor;
    // admin power flows from an ORGANIZATION-scoped RoleBinding.
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: ADMIN_ID,
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      },
    });
    await prisma.organizationUser.create({
      data: { userId: TRACE_ADMIN_ID, organizationId: ORG_ID, role: "MEMBER" },
    });
    await prisma.organizationUser.create({
      data: { userId: PLAIN_ID, organizationId: ORG_ID, role: "MEMBER" },
    });
    // The trace-project administrator: full rights on the team that owns
    // the landing project, nothing anywhere else.
    await prisma.teamUser.create({
      data: { userId: TRACE_ADMIN_ID, teamId: TEAM_OWNER_ID, role: "ADMIN" },
    });
  }, 120_000);

  afterAll(async () => {
    await clearClickHouseTestApp();
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.teamUser.deleteMany({
      where: { teamId: { in: [TEAM_OWNER_ID, TEAM_OTHER_ID] } },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [PROJECT_TRACE_ID, PROJECT_OTHER_ID] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [TEAM_OWNER_ID, TEAM_OTHER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_ID, TRACE_ADMIN_ID, PLAIN_ID] } },
    });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  }, 120_000);

  describe("given a team-owned key whose traces land in another team's project", () => {
    // TEAM-owned rather than ORG-owned on purpose: an org-scoped key is
    // member-visible by design, and the legacy team-admin union grants
    // org-level gateway powers to any team admin. A key owned by a team
    // the caller is NOT in isolates exactly what the trace destination
    // must never grant.
    it("stores the destination as traceProjectId, never as a scope row", async () => {
      const created = await callerFor(ADMIN_ID).virtualKeys.create({
        organizationId: ORG_ID,
        name: `vkab-key-${suffix}`,
        scopes: [{ scopeType: "TEAM", scopeId: TEAM_OTHER_ID }],
        traceProjectId: PROJECT_TRACE_ID,
        budget: { limitUsd: "5", window: "DAY" },
      });
      keyId = created.virtualKey.id;

      const row = await prisma.virtualKey.findUniqueOrThrow({
        where: { id: keyId },
        include: { scopes: true },
      });
      expect(row.traceProjectId).toBe(PROJECT_TRACE_ID);
      expect(row.scopes.map((s) => s.scopeType)).toEqual(["TEAM"]);

      // Traces still land exactly where the creator chose.
      const resolved = await traceProjectFor(prisma, row.traceProjectId);
      expect(resolved?.id).toBe(PROJECT_TRACE_ID);
    });

    describe("when the trace project's administrator comes calling", () => {
      it("does not list or get the key: the destination grants no visibility", async () => {
        const listed = await callerFor(TRACE_ADMIN_ID).virtualKeys.list({
          organizationId: ORG_ID,
        });
        expect(listed.map((k) => k.id)).not.toContain(keyId);

        await expect(
          callerFor(TRACE_ADMIN_ID).virtualKeys.get({
            organizationId: ORG_ID,
            id: keyId,
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });

      it("cannot update, rotate or revoke the key", async () => {
        await expect(
          callerFor(TRACE_ADMIN_ID).virtualKeys.update({
            organizationId: ORG_ID,
            id: keyId,
            name: "hijacked",
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          callerFor(TRACE_ADMIN_ID).virtualKeys.rotate({
            organizationId: ORG_ID,
            id: keyId,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          callerFor(TRACE_ADMIN_ID).virtualKeys.revoke({
            organizationId: ORG_ID,
            id: keyId,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });
  });

  describe("given the applicable-budgets resolver", () => {
    it("refuses a draft for a plain member without manage on the scopes", async () => {
      await expect(
        callerFor(PLAIN_ID).virtualKeys.applicableBudgets({
          organizationId: ORG_ID,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("answers a draft for a caller who could create at those scopes", async () => {
      const rows = await callerFor(TRACE_ADMIN_ID).virtualKeys.applicableBudgets({
        organizationId: ORG_ID,
        scopes: [{ scopeType: "TEAM", scopeId: TEAM_OWNER_ID }],
      });
      expect(Array.isArray(rows)).toBe(true);
    });

    it("refuses an existing key the caller cannot see", async () => {
      await expect(
        callerFor(TRACE_ADMIN_ID).virtualKeys.applicableBudgets({
          organizationId: ORG_ID,
          virtualKeyId: keyId,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("binds an existing key's preview to its stored ownership, ignoring injected scopes", async () => {
      // A sibling team's project budget that must never surface through
      // another key's preview.
      const siblingBudgetId = `gb-vkab-sibling-${suffix}`;
      await prisma.gatewayBudget.create({
        data: {
          id: siblingBudgetId,
          name: "sibling project cap",
          organizationId: ORG_ID,
          scopeType: "PROJECT",
          scopeId: PROJECT_OTHER_ID,
          window: "MONTH",
          limitUsd: "50.00",
          onBreach: "BLOCK",
          createdById: ADMIN_ID,
          resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      // An org-scoped key: visible to every member by design, which is
      // exactly why its preview must not honor caller-supplied scopes.
      const orgKey = await callerFor(ADMIN_ID).virtualKeys.create({
        organizationId: ORG_ID,
        name: `vkab-orgkey-${suffix}`,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        traceProjectId: PROJECT_TRACE_ID,
      });

      const rows = await callerFor(PLAIN_ID).virtualKeys.applicableBudgets({
        organizationId: ORG_ID,
        virtualKeyId: orgKey.virtualKey.id,
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_OTHER_ID }],
      });
      expect(rows.map((r) => r.id)).not.toContain(siblingBudgetId);
    });
  });

  describe("given a manager choosing where a key's traces land", () => {
    it("refuses a destination project the caller does not manage", async () => {
      // Team A's admin, Team B's private project: tenancy passes, the
      // manage grant does not, and before this boundary the debits would
      // have landed in (and drained) the sibling team's project budget.
      await expect(
        callerFor(TRACE_ADMIN_ID).virtualKeys.create({
          organizationId: ORG_ID,
          name: `vkab-crossteam-${suffix}`,
          scopes: [{ scopeType: "TEAM", scopeId: TEAM_OWNER_ID }],
          traceProjectId: PROJECT_OTHER_ID,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("given a key carrying both a drawer-managed budget and an independent cap", () => {
    it("clearing the drawer budget archives only the managed row", async () => {
      const independent = await prisma.gatewayBudget.create({
        data: {
          id: `gb-vkab-indep-${suffix}`,
          name: "independent openai cap",
          organizationId: ORG_ID,
          scopeType: "VIRTUAL_KEY",
          scopeId: keyId,
          window: "MONTH",
          limitUsd: "100.00",
          onBreach: "BLOCK",
          createdById: ADMIN_ID,
          resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const managedBefore = await prisma.gatewayBudget.findFirst({
        where: {
          organizationId: ORG_ID,
          managedByVirtualKeyId: keyId,
          archivedAt: null,
        },
      });
      expect(managedBefore).not.toBeNull();

      await callerFor(ADMIN_ID).virtualKeys.update({
        organizationId: ORG_ID,
        id: keyId,
        budget: null,
      });

      const managedAfter = await prisma.gatewayBudget.findUnique({
        where: { id: managedBefore!.id },
      });
      expect(managedAfter?.archivedAt).not.toBeNull();

      const independentAfter = await prisma.gatewayBudget.findUniqueOrThrow({
        where: { id: independent.id },
      });
      expect(independentAfter.archivedAt).toBeNull();
    });
  });
});

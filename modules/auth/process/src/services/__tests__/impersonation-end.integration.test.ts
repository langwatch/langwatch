/**
 * How an impersonation window ends over real `Session` rows: stopped, run out or replaced, it is
 * audited once for each organization that saw its start, and cleared.
 * @see specs/identity/admin-impersonation.feature
 */
import { randomUUID } from "node:crypto";

import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { type Instant, Temporal } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaAuthSessionRepository } from "../../repositories/prisma/prisma.auth-session.repository.ts";
import {
  IMPERSONATION_EXPIRED_ACTION,
  IMPERSONATION_STARTED_ACTION,
  IMPERSONATION_STOPPED_ACTION,
  ImpersonationEndService,
} from "../impersonation-end.service.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-impersonation-expiry-${randomUUID()}`;
const operatorId = `${namespace}-operator`;
const subjectId = `${namespace}-sam`;
const lapsedSessionId = `${namespace}-lapsed`;
const liveSessionId = `${namespace}-live`;
const oldSessionId = `${namespace}-old`;
// Dated before any real row in the shared test database, so the sweep finds only these.
const NOW = Temporal.Instant.from("2001-01-01T12:00:00.000Z");
const LAPSED_AT = Temporal.Instant.from("2001-01-01T11:55:00.000Z");
const LIVE_UNTIL = Temporal.Instant.from("2001-01-01T12:30:00.000Z");
const HOUR_MS = 60 * 60 * 1_000;
const ORGANIZATIONS = ["org_acme", "org_globex"];

/**
 * The audit log as the service sees it: rows kept in order with when they were written, the
 * recorded-since check answered over them. Each window's start rows are seeded as ops writes
 * them (one per organization, naming the session); `oldSessionId`'s window predates them.
 */
function recordingAuditLog({ failOnceFor }: { failOnceFor?: string } = {}) {
  const written: { row: RecordAuditLogCommand; atMs: number }[] = [];
  const rows: RecordAuditLogCommand[] = [];
  let failing = failOnceFor;
  const startRows = ({ sessionId, expiresAt }: { sessionId: string; expiresAt: Instant }) => {
    for (const organizationId of ORGANIZATIONS) {
      written.push({
        row: {
          userId: operatorId,
          organizationId,
          action: IMPERSONATION_STARTED_ACTION,
          targetKind: "session",
          targetId: sessionId,
          args: { userIdToImpersonate: subjectId, reason: "Ticket 42" },
        },
        atMs: expiresAt.epochMilliseconds - HOUR_MS,
      });
    }
  };
  startRows({ sessionId: lapsedSessionId, expiresAt: LAPSED_AT });
  startRows({ sessionId: liveSessionId, expiresAt: LIVE_UNTIL });
  const auditLog = createApiFixture<AuditLogApi>({
    record: async (command) => {
      if (failing && command.organizationId === failing) {
        failing = undefined;
        throw new Error("audit write failed");
      }
      rows.push(command);
      written.push({ row: command, atMs: NOW.epochMilliseconds });
      return { id: `audit-${rows.length}`, occurredAt: NOW.epochMilliseconds };
    },
    hasRecordedSince: async ({ userId, action, targetKind, targetId, organizationId, sinceMs }) =>
      written.some(({ row, atMs }) => {
        if (organizationId && row.organizationId !== organizationId) return false;
        return (
          atMs >= sinceMs &&
          row.userId === userId &&
          row.action === action &&
          row.targetKind === targetKind &&
          row.targetId === targetId
        );
      }),
  });
  return { rows, auditLog, startRows };
}

describe.skipIf(!databaseUrl)("ImpersonationEndService over Postgres", () => {
  let connection: PrismaConnection;
  let sessions: PrismaAuthSessionRepository;

  const sessionRow = (id: string) =>
    connection.client.session.findUniqueOrThrow({
      where: { id },
      select: { actorUserId: true, subjectUserId: true, impersonationExpiresAt: true },
    });

  const serviceWith = (auditLog: AuditLogApi) =>
    ImpersonationEndService.create({
      sessions,
      memberships: createApiFixture<OrganizationApi>({
        organizationIdsForMember: async ({ userId }) => (userId === subjectId ? ORGANIZATIONS : []),
      }),
      auditLog,
      now: () => NOW,
    });

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:auth:test:impersonation-expiry"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    sessions = PrismaAuthSessionRepository.create({ prisma: connection.client });

    for (const id of [operatorId, subjectId]) {
      await connection.client.user.create({ data: { id, email: `${id}@example.com`, name: id } });
    }
    for (const id of [lapsedSessionId, liveSessionId, oldSessionId]) {
      await connection.client.session.create({
        data: {
          id,
          sessionToken: `${id}-token`,
          userId: operatorId,
          expires: new Date("2030-01-01T00:00:00.000Z"),
        },
      });
    }
  });

  beforeEach(async () => {
    for (const [sessionId, expiresAt] of [
      [lapsedSessionId, LAPSED_AT],
      [liveSessionId, LIVE_UNTIL],
      [oldSessionId, LAPSED_AT],
    ] as const) {
      await sessions.writeImpersonation({
        sessionId,
        claims: {
          actorUserId: operatorId,
          subjectUserId: subjectId,
          reason: "Ticket 42",
          expiresAt,
        },
      });
    }
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.session.deleteMany({ where: { userId: operatorId } });
    await connection.client.user.deleteMany({ where: { id: { in: [operatorId, subjectId] } } });
    await connection.closeOnce();
  });

  describe("when a window passed without a stop", () => {
    /** @scenario "An impersonation that runs out is audited and cleared" */
    it("records it as expired for each organization, operator as actor, and clears it", async () => {
      const { rows, auditLog } = recordingAuditLog();

      await serviceWith(auditLog).sweep();

      const ours = rows.filter((row) => row.targetId === lapsedSessionId);
      expect(ours).toEqual(
        ["org_acme", "org_globex"].map((organizationId) => ({
          userId: operatorId,
          actorUserId: operatorId,
          organizationId,
          action: IMPERSONATION_EXPIRED_ACTION,
          targetKind: "session",
          targetId: lapsedSessionId,
          args: {
            userIdImpersonated: subjectId,
            reason: "Ticket 42",
            expiredAt: LAPSED_AT.toString(),
          },
        })),
      );
      await expect(sessionRow(lapsedSessionId)).resolves.toEqual({
        actorUserId: null,
        subjectUserId: null,
        impersonationExpiresAt: null,
      });
    });
  });

  describe("when the window is still open", () => {
    /** @scenario "A live impersonation is left alone by the expiry sweep" */
    it("records nothing for it and keeps the claims", async () => {
      const { rows, auditLog } = recordingAuditLog();

      await serviceWith(auditLog).sweep();

      expect(rows.filter((row) => row.targetId === liveSessionId)).toEqual([]);
      await expect(sessionRow(liveSessionId)).resolves.toMatchObject({
        actorUserId: operatorId,
        subjectUserId: subjectId,
      });
    });
  });

  describe("when the expiry was already recorded but the claims were not cleared", () => {
    /** @scenario "An expired impersonation is recorded once" */
    it("writes no second row and clears the claims", async () => {
      const { rows, auditLog } = recordingAuditLog();
      const service = serviceWith(auditLog);
      await service.sweep();
      await sessions.writeImpersonation({
        sessionId: lapsedSessionId,
        claims: {
          actorUserId: operatorId,
          subjectUserId: subjectId,
          reason: "Ticket 42",
          expiresAt: LAPSED_AT,
        },
      });

      await service.sweep();

      expect(rows.filter((row) => row.targetId === lapsedSessionId)).toHaveLength(2);
      await expect(sessionRow(lapsedSessionId)).resolves.toMatchObject({ actorUserId: null });
    });
  });

  describe("when the row for one organization failed and the sweep runs again", () => {
    /** @scenario "An expired impersonation is recorded once" */
    it("writes only the missing organization's row", async () => {
      const { rows, auditLog } = recordingAuditLog({ failOnceFor: "org_globex" });
      const service = serviceWith(auditLog);
      await expect(service.sweep()).rejects.toThrow("audit write failed");

      await service.sweep();

      const ours = rows.filter((row) => row.targetId === lapsedSessionId);
      expect(ours.map((row) => row.organizationId)).toEqual(["org_acme", "org_globex"]);
      await expect(sessionRow(lapsedSessionId)).resolves.toMatchObject({ actorUserId: null });
    });
  });

  describe("when a lapsed window was opened before start rows named the session", () => {
    /** @scenario "A window opened before customers saw starts ends in the operators' log only" */
    it("writes no customer row, keeps one operator-only row and clears it", async () => {
      const { rows, auditLog } = recordingAuditLog();

      await serviceWith(auditLog).sweep();

      expect(rows.filter((row) => row.targetId === oldSessionId)).toEqual([
        {
          userId: operatorId,
          actorUserId: operatorId,
          action: IMPERSONATION_EXPIRED_ACTION,
          targetKind: "session",
          targetId: oldSessionId,
          args: {
            userIdImpersonated: subjectId,
            reason: "Ticket 42",
            expiredAt: LAPSED_AT.toString(),
          },
        },
      ]);
      await expect(sessionRow(oldSessionId)).resolves.toMatchObject({ actorUserId: null });
    });
  });

  describe("when the operator stops a live window", () => {
    /** @scenario "A stopped impersonation is recorded as ended for each organization" */
    it("records it as stopped for each organization once and clears it", async () => {
      const { rows, auditLog } = recordingAuditLog();
      const service = serviceWith(auditLog);

      await service.stop({ sessionId: liveSessionId });
      await service.stop({ sessionId: liveSessionId });
      await service.sweep();

      const ours = rows.filter((row) => row.targetId === liveSessionId);
      expect(ours).toEqual(
        ORGANIZATIONS.map((organizationId) => ({
          userId: operatorId,
          actorUserId: operatorId,
          organizationId,
          action: IMPERSONATION_STOPPED_ACTION,
          targetKind: "session",
          targetId: liveSessionId,
          args: { userIdImpersonated: subjectId, reason: "Ticket 42", stoppedAt: NOW.toString() },
        })),
      );
      await expect(sessionRow(liveSessionId)).resolves.toEqual({
        actorUserId: null,
        subjectUserId: null,
        impersonationExpiresAt: null,
      });
    });
  });

  describe("when the operator stops after the window ran out but before the sweep", () => {
    /** @scenario "A stop after the window ran out records it as expired once" */
    it("records it as expired for each organization and the sweep adds nothing", async () => {
      const { rows, auditLog } = recordingAuditLog();
      const service = serviceWith(auditLog);

      await service.stop({ sessionId: lapsedSessionId });
      await service.sweep();

      const ours = rows.filter((row) => row.targetId === lapsedSessionId);
      expect(ours.map(({ organizationId, action }) => ({ organizationId, action }))).toEqual(
        ORGANIZATIONS.map((organizationId) => ({
          organizationId,
          action: IMPERSONATION_EXPIRED_ACTION,
        })),
      );
      await expect(sessionRow(lapsedSessionId)).resolves.toMatchObject({ actorUserId: null });
    });
  });

  describe("when a new window is started over a lapsed one", () => {
    /** @scenario "A new window over a lapsed one records the lapsed one as expired once" */
    it("records the lapsed window as expired once and keeps the new window live", async () => {
      const { rows, auditLog, startRows } = recordingAuditLog();
      const service = serviceWith(auditLog);
      const nextUntil = NOW.add({ milliseconds: HOUR_MS });
      startRows({ sessionId: lapsedSessionId, expiresAt: nextUntil });

      await service.start({
        sessionId: lapsedSessionId,
        actorUserId: operatorId,
        subjectUserId: subjectId,
        reason: "Ticket 43",
        expiresAt: nextUntil,
      });
      await service.sweep();

      const ours = rows.filter((row) => row.targetId === lapsedSessionId);
      expect(
        ours.map(({ organizationId, action, args }) => ({ organizationId, action, args })),
      ).toEqual(
        ORGANIZATIONS.map((organizationId) => ({
          organizationId,
          action: IMPERSONATION_EXPIRED_ACTION,
          args: {
            userIdImpersonated: subjectId,
            reason: "Ticket 42",
            expiredAt: LAPSED_AT.toString(),
          },
        })),
      );
      await expect(sessionRow(lapsedSessionId)).resolves.toEqual({
        actorUserId: operatorId,
        subjectUserId: subjectId,
        impersonationExpiresAt: new Date(nextUntil.epochMilliseconds),
      });
    });
  });

  describe("when a new window was started after the lapsed one was read", () => {
    it("clears only the window it read, never a newer one", async () => {
      await expect(
        sessions.clearLapsedImpersonation({
          sessionId: liveSessionId,
          expiresAt: LAPSED_AT,
        }),
      ).resolves.toBe(false);
      await expect(sessionRow(liveSessionId)).resolves.toMatchObject({ actorUserId: operatorId });
    });
  });
});

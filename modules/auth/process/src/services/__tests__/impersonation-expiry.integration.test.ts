/**
 * The impersonation expiry sweep over real `Session` rows: a window that ran out without a stop
 * is audited per organization and cleared, once. @see specs/identity/admin-impersonation.feature
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
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaAuthSessionRepository } from "../../repositories/prisma/prisma.auth-session.repository.ts";
import {
  IMPERSONATION_EXPIRED_ACTION,
  ImpersonationExpiryService,
} from "../impersonation-expiry.service.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-impersonation-expiry-${randomUUID()}`;
const operatorId = `${namespace}-operator`;
const subjectId = `${namespace}-sam`;
const lapsedSessionId = `${namespace}-lapsed`;
const liveSessionId = `${namespace}-live`;
// Dated before any real row in the shared test database, so the sweep finds only these.
const NOW = Temporal.Instant.from("2001-01-01T12:00:00.000Z");
const LAPSED_AT = Temporal.Instant.from("2001-01-01T11:55:00.000Z");
const LIVE_UNTIL = Temporal.Instant.from("2001-01-01T12:30:00.000Z");

/** The audit log as the sweep sees it: rows kept in order, the recorded-since check answered. */
function recordingAuditLog() {
  const rows: RecordAuditLogCommand[] = [];
  const auditLog = createApiFixture<AuditLogApi>({
    record: async (command) => {
      rows.push(command);
      return { id: `audit-${rows.length}`, occurredAt: NOW.epochMilliseconds };
    },
    hasRecordedSince: async ({ userId, action, targetKind, targetId }) =>
      rows.some(
        (row) =>
          row.userId === userId &&
          row.action === action &&
          row.targetKind === targetKind &&
          row.targetId === targetId,
      ),
  });
  return { rows, auditLog };
}

describe.skipIf(!databaseUrl)("ImpersonationExpiryService over Postgres", () => {
  let connection: PrismaConnection;
  let sessions: PrismaAuthSessionRepository;

  const sessionRow = (id: string) =>
    connection.client.session.findUniqueOrThrow({
      where: { id },
      select: { actorUserId: true, subjectUserId: true, impersonationExpiresAt: true },
    });

  const serviceWith = (auditLog: AuditLogApi) =>
    ImpersonationExpiryService.create({
      sessions,
      memberships: createApiFixture<OrganizationApi>({
        organizationIdsForMember: async ({ userId }) =>
          userId === subjectId ? ["org_acme", "org_globex"] : [],
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
    for (const id of [lapsedSessionId, liveSessionId]) {
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

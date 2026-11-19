/**
 * Kill switch audit rows go through governance's outbox, keyed once at the request.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { ProcessStore } from "@langwatch/eventing";
import { parse } from "@langwatch/ksuid";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  OutboxKillSwitchAudit,
  recordKillSwitchAudit,
} from "../../eventing/kill-switch-audit.intent.ts";
import { KillSwitchAuditService } from "../kill-switch-audit.service.ts";
import { ORG } from "./kill-switch.fixtures.ts";

type AppendedIntents = Parameters<ProcessStore["appendIntents"]>[0];

describe("KillSwitchAuditService", () => {
  describe("when a pipeline has connected the audit outbox", () => {
    /** @scenario "A kill switch audit row is written through the outbox, once per key" */
    it("appends the keyed intent, and its redelivery writes one row", async () => {
      const appended: AppendedIntents[] = [];
      const processStore: Pick<ProcessStore, "appendIntents"> = {
        appendIntents: async (params) => {
          appended.push(params);
          return undefined as never;
        },
      };
      const rows = new Map<string, RecordAuditLogCommand>();
      const auditLog = createApiFixture<AuditLogApi>({
        record: async (command) => {
          if (command.idempotencyKey && !rows.has(command.idempotencyKey)) {
            rows.set(command.idempotencyKey, command);
          }
          return { id: "audit", occurredAt: 0 };
        },
      });
      const service = KillSwitchAuditService.create({
        auditLog,
        outbox: () => OutboxKillSwitchAudit.create(processStore),
        newKey: () => "audit-key-1",
      });

      await service.record({
        organizationId: ORG,
        userId: "user-ops",
        action: "governance.agent.aws_connection_deleted",
        targetKind: "governance_aws_connection",
        targetId: "awsconn-1",
      });

      expect(rows.size).toBe(0);
      const message = appended[0]?.messages[0];
      expect(message).toMatchObject({ messageKey: "audit-key-1", intentType: "recordAudit" });
      const deliver = recordKillSwitchAudit(auditLog);
      await deliver(message?.payload as never);
      await deliver(message?.payload as never);
      expect([...rows.values()]).toEqual([
        expect.objectContaining({
          idempotencyKey: "audit-key-1",
          action: "governance.agent.aws_connection_deleted",
        }),
      ]);
    });
  });

  describe("when a request's row is recorded with the moment it was asked", () => {
    /** @scenario "A request and the milestone it causes list in causal order, even in one second" */
    it("dates the row at that millisecond and keys it in the same second", async () => {
      const rows: RecordAuditLogCommand[] = [];
      const service = KillSwitchAuditService.create({
        auditLog: createApiFixture<AuditLogApi>({
          record: async (command) => {
            rows.push(command);
            return { id: "audit", occurredAt: command.occurredAt ?? 0 };
          },
        }),
        outbox: () => undefined,
        now: () => Date.parse("2026-11-19T18:44:02.000Z"),
      });
      const askedAt = Date.parse("2026-11-19T18:43:39.987Z");

      await service.record({
        organizationId: ORG,
        action: "governance.agent.restore_requested",
        occurredAt: askedAt,
      });

      expect(rows[0]?.occurredAt).toBe(askedAt);
      expect(parse(rows[0]?.idempotencyKey ?? "").date.toISOString()).toBe(
        "2026-11-19T18:43:39.000Z",
      );
    });
  });
});

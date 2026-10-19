/**
 * @vitest-environment node
 * @see modules/insight/specs/insight-daily-run-hardening.feature
 */

import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { InsightRunSettledEventData } from "@langwatch/insight-contract";
import { parse } from "@langwatch/ksuid";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  INSIGHT_DAILY_RUN_AUDIT_ACTION,
  INSIGHT_DAILY_RUN_AUDIT_TARGET_KIND,
  InsightDailyRunAuditService,
} from "../insight-daily-run-audit.service.ts";

const RUN: InsightRunSettledEventData = {
  scheduleId: "schedule-1",
  userId: "user-1",
  board: { kind: "dashboard", id: "dashboard-1", name: "Costs" },
  runId: "slot:1",
  slot: Date.UTC(2026, 9, 10, 9, 37),
  outcome: "filed",
  reason: null,
  filedCount: 2,
  renewedCount: 1,
  conversationId: "conversation-1",
};

function harness() {
  const written: RecordAuditLogCommand[] = [];
  const service = InsightDailyRunAuditService.create({
    auditLog: createApiFixture<Pick<AuditLogApi, "record">>({
      record: async (line) => {
        written.push(line);
        return { id: "audit-1", occurredAt: RUN.slot };
      },
    }),
  });
  const record = (run: Partial<InsightRunSettledEventData> = {}) =>
    service.recordSettled({ projectId: "project-1", run: { ...RUN, ...run } });
  return { written, record };
}

describe("given a run's recorded outcome", () => {
  it("writes who the run acted for, the schedule, the board and how it ended", async () => {
    const { written, record } = harness();

    await record();

    expect(written).toEqual([
      {
        idempotencyKey: expect.any(String),
        userId: "user-1",
        projectId: "project-1",
        action: INSIGHT_DAILY_RUN_AUDIT_ACTION,
        targetKind: INSIGHT_DAILY_RUN_AUDIT_TARGET_KIND,
        targetId: "schedule-1",
        metadata: {
          runId: "slot:1",
          slot: RUN.slot,
          board: RUN.board,
          outcome: "filed",
          reason: null,
          filedCount: 2,
          renewedCount: 1,
          conversationId: "conversation-1",
        },
      },
    ]);
  });

  describe("when the audit subscriber is handed it twice", () => {
    /** @scenario "An outcome delivered twice writes one audit line" */
    it("carries the same audit key both times, stamped with the run's slot", async () => {
      const { written, record } = harness();

      await record();
      await record({ outcome: "failed", reason: "error" });
      const [first, second] = written.map(({ idempotencyKey }) => idempotencyKey ?? "");
      const key = parse(first ?? "");

      expect(second).toBe(first);
      expect(key.resource).toBe("audit");
      expect(key.date.getTime()).toBe(Math.floor(RUN.slot / 1000) * 1000);
    });

    it("names another line for another run, and for the same run id on another schedule", async () => {
      const { written, record } = harness();

      await record();
      await record({ runId: "slot:2" });
      await record({ scheduleId: "schedule-2" });

      expect(new Set(written.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(3);
    });

    it("writes a key the audit log can read, whatever the run is named", async () => {
      const { written, record } = harness();

      for (let at = 0; at < 64; at += 1) await record({ runId: `slot:${at}` });
      const resources = written.map(({ idempotencyKey }) => parse(idempotencyKey ?? "").resource);

      expect(new Set(resources)).toEqual(new Set(["audit"]));
    });
  });
});

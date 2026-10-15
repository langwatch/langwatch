import { createHash } from "node:crypto";

import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { InsightRunSettledEventData } from "@langwatch/insight-contract";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";

export const INSIGHT_DAILY_RUN_AUDIT_ACTION = "insight.dailyRun.settled";
export const INSIGHT_DAILY_RUN_AUDIT_TARGET_KIND = "insight_daily_schedule";

/** The audit log takes an `audit` KSUID as a key, and reads the line's moment from it. */
const AUDIT_KEY_RESOURCE = "audit";

/**
 * The key of one run's line: the run's own name and slot, so an outcome recorded or delivered
 * twice names one line. The audit log reads the line's moment from the key: the run's slot.
 */
function auditKeyOf({ scheduleId, runId, slot }: InsightRunSettledEventData): string {
  const digest = createHash("sha256").update(`${scheduleId}\u001f${runId}`).digest();
  return new Ksuid({
    environment: getEnvironment(),
    resource: AUDIT_KEY_RESOURCE,
    timestamp: Math.floor(slot / 1000),
    instance: new Instance(Instance.schemes.RANDOM, new Uint8Array(digest.subarray(0, 8))),
    // The KSUID parser reads the sequence as a signed number: its top bit stays clear.
    sequenceId: digest.readUInt32BE(8) >>> 1,
  }).toString();
}

/**
 * One audit-log line per run: who the run acted for, the board, how it ended and why, and what
 * it filed and renewed. A run skipped before it started is a run too, and so has a line.
 */
export class InsightDailyRunAuditService {
  private constructor(private readonly auditLog: Pick<AuditLogApi, "record">) {}

  static create({
    auditLog,
  }: {
    auditLog: Pick<AuditLogApi, "record">;
  }): InsightDailyRunAuditService {
    return new InsightDailyRunAuditService(auditLog);
  }

  async recordSettled({
    projectId,
    run,
  }: {
    projectId: string;
    run: InsightRunSettledEventData;
  }): Promise<void> {
    const { scheduleId, userId, board, runId, slot, outcome, reason } = run;
    const { filedCount, renewedCount, conversationId } = run;
    await this.auditLog.record({
      idempotencyKey: auditKeyOf(run),
      // The run read and filed as this person, with nobody at the keyboard.
      userId,
      projectId,
      action: INSIGHT_DAILY_RUN_AUDIT_ACTION,
      targetKind: INSIGHT_DAILY_RUN_AUDIT_TARGET_KIND,
      targetId: scheduleId,
      metadata: { runId, slot, board, outcome, reason, filedCount, renewedCount, conversationId },
    });
  }
}

/**
 * @vitest-environment node
 * A suppression read's audit rides automation's own outbox (Alex, Q72): the request records the
 * intent, the worker's outbox writes it after commit and retries a failed write with the same key.
 */
import {
  auditLogIntentSchema,
  type AuditLogApi,
  type RecordAuditLogCommand,
} from "@langwatch/audit-log-contract";
import { InMemoryProcessStore, OutboxDispatcherService } from "@langwatch/eventing";
import { parse } from "@langwatch/ksuid";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { automationProcessDefinition } from "../../__tests__/fixtures/pipeline-test-harness.ts";
import { OutboxAutomationAuditSink } from "../automation-audit.intent.ts";
import {
  AUTOMATION_AUDIT_PROCESS_NAME,
  AUTOMATION_AUDIT_RECORD_INTENT,
} from "../automation-audit.process.ts";

/** An audit log whose first write fails, as a database blip would. */
function flakyAuditLog() {
  const writes: RecordAuditLogCommand[] = [];
  let failures = 1;
  const auditLog = createApiFixture<AuditLogApi>({
    record: async (command) => {
      writes.push(command);
      if (failures-- > 0) throw new Error("audit log unavailable");
      return { id: command.idempotencyKey ?? "audit", occurredAt: 0 };
    },
  });
  return { auditLog, writes };
}

function outboxOver(auditLog: AuditLogApi) {
  const store = InMemoryProcessStore.createForTesting();
  const definition = automationProcessDefinition({ name: AUTOMATION_AUDIT_PROCESS_NAME, auditLog });
  const intent = definition.config.intents[AUTOMATION_AUDIT_RECORD_INTENT]!;
  const dispatcher = new OutboxDispatcherService({
    store,
    processNames: [AUTOMATION_AUDIT_PROCESS_NAME],
    retryDelayMs: () => 0,
    handlers: {
      [AUTOMATION_AUDIT_RECORD_INTENT]: ({ message }) =>
        intent.run(auditLogIntentSchema.parse(message.payload), {
          processName: AUTOMATION_AUDIT_PROCESS_NAME,
          projectId: "project-1",
          processKey: "audit",
          tenantId: "project-1",
          messageKey: message.messageKey,
          attempt: 1,
        }),
    },
  });
  return { store, dispatcher };
}

describe("automation's audit outbox", () => {
  describe("when a suppression read is audited and the first write to the audit log fails", () => {
    /** @scenario "A failed audit delivery is retried from the producer's outbox" */
    it("records the intent at once and writes it on redelivery under the same key", async () => {
      const { auditLog, writes } = flakyAuditLog();
      const { store, dispatcher } = outboxOver(auditLog);

      await OutboxAutomationAuditSink.create(store).record({
        userId: "user-1",
        projectId: "project-1",
        action: "emailSuppression.getAll",
        args: { recordCount: 2 },
      });
      expect(writes).toHaveLength(0);

      const now = nowInstant().epochMilliseconds + 1;
      await dispatcher.runOnce({ now });
      await dispatcher.runOnce({ now: now + 1 });

      expect(writes).toHaveLength(2);
      const [first, second] = writes;
      expect(second).toEqual(first);
      expect(parse(first!.idempotencyKey!).resource).toBe("audit");
      expect(first).toMatchObject({
        userId: "user-1",
        projectId: "project-1",
        action: "emailSuppression.getAll",
        args: { recordCount: 2 },
      });
    });
  });
});

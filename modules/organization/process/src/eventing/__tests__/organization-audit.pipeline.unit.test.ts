/**
 * @vitest-environment node
 * organization_audit: an audit intent in organization's outbox records the audit fact on
 * organization's own pipeline; audit-log reacts from its side (Alex, 2026-10-06; record §9).
 * @see modules/audit-log/specs/audit-log.feature
 */
import { createTenantId, InMemoryProcessStore, OutboxDispatcherService } from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import { ORGANIZATION_AUDIT_RECORDED_EVENT_TYPE } from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  ORGANIZATION_AUDIT_PROCESS_NAME,
  ORGANIZATION_AUDIT_RECORD_INTENT,
  organizationAuditAppend,
} from "../../rules/organization-audit.rules.ts";
import {
  RECORD_AUDIT_COMMAND_TYPE,
  RecordAuditCommand,
  type RecordAuditCommandData,
  recordAuditCommandDataSchema,
} from "../organization-audit.commands.ts";
import type { OrganizationAuditSender } from "../organization-audit.intent.ts";
import { buildOrganizationAuditPipeline } from "../organization-audit.pipeline.ts";

function admissionFact(): RecordAuditCommandData {
  const key = generate("audit");
  return {
    tenantId: "org_acme",
    occurredAt: key.date.getTime(),
    idempotencyKey: key.toString(),
    organizationId: "org_acme",
    userId: "user_sam",
    actorUserId: "user_admin",
    action: "organization.member.admitted",
    metadata: { seat: "DEVELOPER", inviteId: "invite_1", via: "invite" },
  };
}

function outboxOver(sender: () => OrganizationAuditSender | undefined) {
  const store = InMemoryProcessStore.createForTesting();
  const pipeline = buildOrganizationAuditPipeline({ sender, retention: store });
  const intent = pipeline.processManagers.get(ORGANIZATION_AUDIT_PROCESS_NAME)?.config.intents[
    ORGANIZATION_AUDIT_RECORD_INTENT
  ];
  if (!intent) throw new Error("organization_audit declares no record intent");
  const dispatcher = new OutboxDispatcherService({
    store,
    processNames: [ORGANIZATION_AUDIT_PROCESS_NAME],
    retryDelayMs: () => 0,
    handlers: {
      [ORGANIZATION_AUDIT_RECORD_INTENT]: ({ message }) =>
        intent.run(recordAuditCommandDataSchema.parse(message.payload), {
          processName: ORGANIZATION_AUDIT_PROCESS_NAME,
          projectId: "org_acme",
          processKey: "audit",
          tenantId: "org_acme",
          messageKey: message.messageKey,
          attempt: 1,
        }),
    },
  });
  return { store, dispatcher };
}

describe("given an audit intent in organization's outbox", () => {
  describe("when the outbox delivers it", () => {
    /** @scenario Organization's audit intent records its audit fact */
    it("sends organization's own record command, and the fact is keyed by the intent's audit id", async () => {
      const send = vi.fn(async () => {});
      const { store, dispatcher } = outboxOver(() => ({ send }));
      const fact = admissionFact();

      await store.appendIntents(organizationAuditAppend({ fact }));
      await dispatcher.runOnce({ now: nowInstant().epochMilliseconds + 1 });

      expect(send).toHaveBeenCalledExactlyOnceWith(fact);
      const [event] = new RecordAuditCommand().handle({
        tenantId: createTenantId(fact.tenantId),
        aggregateId: fact.tenantId,
        type: RECORD_AUDIT_COMMAND_TYPE,
        data: fact,
      });
      expect(event).toMatchObject({
        type: ORGANIZATION_AUDIT_RECORDED_EVENT_TYPE,
        aggregateId: "org_acme",
        idempotencyKey: fact.idempotencyKey,
        occurredAt: fact.occurredAt,
        data: fact,
      });
    });
  });

  describe("when the outbox delivers it before the pipeline answered with its sender", () => {
    it("fails the delivery, so the intent stays for a retry rather than being dropped", async () => {
      let sender: OrganizationAuditSender | undefined;
      const send = vi.fn(async () => {});
      const { store, dispatcher } = outboxOver(() => sender);
      const fact = admissionFact();
      await store.appendIntents(organizationAuditAppend({ fact }));

      const now = nowInstant().epochMilliseconds + 1;
      await dispatcher.runOnce({ now });
      sender = { send };
      await dispatcher.runOnce({ now: now + 1 });

      expect(send).toHaveBeenCalledExactlyOnceWith(fact);
    });
  });
});

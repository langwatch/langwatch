/**
 * @vitest-environment node
 * Audit-log writes organization's audit facts as its own rows (Alex, 2026-10-06; record §9).
 * @see modules/audit-log/specs/audit-log.feature
 */
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { generate } from "@langwatch/ksuid";
import {
  ORGANIZATION_AUDIT_RECORDED_EVENT_TYPE,
  ORGANIZATION_AUDIT_RECORDED_EVENT_VERSION,
  type OrganizationAuditRecordedEventData,
  organizationAuditRecordedEventDataSchema,
} from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MemoryAuditLogRepository } from "../../repositories/memory/memory.audit-log.repository.ts";
import { MemoryAuditLogStore } from "../../repositories/memory/memory.audit-log.store.ts";
import { AuditLogService } from "../../services/audit-log.service.ts";
import { buildAuditLogPipeline } from "../audit-log.pipeline.ts";

/** Organization's pipeline as its contract names the audit fact. */
function organizationStandIn() {
  return definePipeline({
    name: "organization_stand_in",
    aggregate: defineAggregate({ type: "organization_audit" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(ORGANIZATION_AUDIT_RECORDED_EVENT_TYPE),
        data: organizationAuditRecordedEventDataSchema,
      }),
    ])
    .build();
}

function harness() {
  const store = new MemoryAuditLogStore();
  const entries = AuditLogService.create({
    repository: MemoryAuditLogRepository.create({ store }),
    maxArgsBytes: 4096,
  });
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const owner = eventing.register(organizationStandIn());
  const record = vi.fn((command: Parameters<AuditLogService["record"]>[0]) =>
    entries.record(command),
  );
  eventing.register(buildAuditLogPipeline({ entries: { record } }));
  const append = (fact: OrganizationAuditRecordedEventData, id: string) =>
    owner.service.storeEvents(
      [
        {
          id,
          aggregateId: fact.tenantId,
          aggregateType: "organization_audit",
          tenantId: createTenantId(fact.tenantId),
          type: ORGANIZATION_AUDIT_RECORDED_EVENT_TYPE,
          version: ORGANIZATION_AUDIT_RECORDED_EVENT_VERSION,
          createdAt: fact.occurredAt,
          occurredAt: fact.occurredAt,
          idempotencyKey: fact.idempotencyKey,
          data: fact,
        },
      ],
      { tenantId: createTenantId(fact.tenantId) },
    );
  return { store, append, record };
}

describe("given organization recorded an audit fact keyed by an audit id", () => {
  describe("when audit-log's subscriber receives the fact twice", () => {
    /** @scenario An organization audit fact delivered twice writes one audit row */
    it("stores one row under that key, with organization's action and metadata", async () => {
      const { store, append, record } = harness();
      const key = generate("audit");
      const fact: OrganizationAuditRecordedEventData = {
        tenantId: "org_acme",
        occurredAt: key.date.getTime(),
        idempotencyKey: key.toString(),
        organizationId: "org_acme",
        userId: "user_sam",
        actorUserId: "user_admin",
        action: "organization.member.admitted",
        metadata: { seat: "DEVELOPER", inviteId: "invite_1", via: "invite" },
      };

      await append(fact, "event-first");
      await append(fact, "event-redelivered");

      await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2));
      await Promise.all(record.mock.results.map((result) => result.value));
      expect(store.rows).toEqual([
        expect.objectContaining({
          idempotencyKey: key.toString(),
          organizationId: "org_acme",
          userId: "user_sam",
          actorUserId: "user_admin",
          action: "organization.member.admitted",
          metadata: { seat: "DEVELOPER", inviteId: "invite_1", via: "invite" },
        }),
      ]);
      expect(store.rows[0]?.createdAt.epochMilliseconds).toBe(key.date.getTime());
    });
  });
});

/**
 * @vitest-environment node
 *
 * Authz turns its own engine switch off from ops' rollback fact (Alex, 2026-10-12).
 * @see modules/authz/specs/engine-switch.feature
 */
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  TENANT_MIGRATION_ROLLED_BACK_EVENT_TYPE,
  tenantMigrationRolledBackEventDataSchema,
} from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AuthzAuditTrailRepository } from "../../repositories/authz-audit-trail.repository.ts";
import { AuthzGrantProjectionRepository } from "../../repositories/authz-grant-projection.repository.ts";
import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzCutoverRepository } from "../../repositories/memory/memory.authz.repositories.ts";
import { AuthzCutoverGateService } from "../../services/authz-cutover-gate.service.ts";
import { EventingAuthzAdapter } from "../authz-grant.pipeline.ts";

const ORG_ID = "org_acme";
const OTHER_ORG_ID = "org_other";
const SWITCHED_AT = Temporal.Instant.from("2026-08-18T09:00:00.000Z");

class NullAuthzGrantProjectionRepository extends AuthzGrantProjectionRepository {
  async append(): Promise<void> {}
}

class NullAuthzAuditTrailRepository extends AuthzAuditTrailRepository {
  async insert(): Promise<void> {}
}

/** Ops' pipeline as its contract names the rollback fact. */
function opsStandIn() {
  return definePipeline({
    name: "ops_stand_in",
    aggregate: defineAggregate({ type: "system_migration_pass" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(TENANT_MIGRATION_ROLLED_BACK_EVENT_TYPE),
        data: tenantMigrationRolledBackEventDataSchema,
      }),
    ])
    .build();
}

function harness() {
  const memory = AuthzMemoryStore.create();
  for (const organizationId of [ORG_ID, OTHER_ORG_ID]) {
    memory.cutovers.set(organizationId, {
      organizationId,
      onEngine: true,
      switchedAt: SWITCHED_AT,
    });
  }
  const eventing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
  const owner = eventing.register(opsStandIn());
  eventing.register(
    EventingAuthzAdapter.build({
      authzGrantsWriteStore: new NullAuthzGrantProjectionRepository(),
      authzAuditTrailStore: new NullAuthzAuditTrailRepository(),
      engineSwitch: AuthzCutoverGateService.create({
        repository: MemoryAuthzCutoverRepository.create({ memory }),
      }),
    }),
  );
  let sequence = 0;
  const rolledBack = ({ organizationId, stepId }: { organizationId: string; stepId: string }) => {
    sequence += 1;
    const occurredAt = SWITCHED_AT.epochMilliseconds + sequence;
    return owner.service.storeEvents(
      [
        {
          id: `event-${sequence}`,
          aggregateId: `${stepId}:${organizationId}`,
          aggregateType: "system_migration_pass",
          tenantId: createTenantId(organizationId),
          version: "2026-10-12",
          createdAt: occurredAt,
          occurredAt,
          type: TENANT_MIGRATION_ROLLED_BACK_EVENT_TYPE,
          data: { rolledBackTenantId: organizationId, stepId, actorUserId: "user_operator" },
        },
      ],
      { tenantId: createTenantId(organizationId) },
    );
  };
  return { eventing, memory, rolledBack };
}

describe("authz's engine switch, kept from ops' rollback fact", () => {
  /** @scenario "An operator's rollback turns authz's switch off" */
  it("pins the rolled-back organization off and leaves another step's rollback alone", async () => {
    const { eventing, memory, rolledBack } = harness();

    await rolledBack({ organizationId: OTHER_ORG_ID, stepId: "identity:identifier-backfill" });
    await rolledBack({ organizationId: ORG_ID, stepId: "authz:engine" });
    await vi.waitFor(() =>
      expect(memory.cutovers.get(ORG_ID)).toMatchObject({ onEngine: false, pinned: true }),
    );

    expect(memory.cutovers.get(OTHER_ORG_ID)).toMatchObject({ onEngine: true });
    await eventing.close();
  });
});

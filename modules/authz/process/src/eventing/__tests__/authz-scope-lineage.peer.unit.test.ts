/**
 * @vitest-environment node
 *
 * Authz moves its lineage signal from project's moved and archived facts, from its own side (§9).
 * @see modules/authz/specs/authz-epoch-cache.feature
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
  PROJECT_ARCHIVED_EVENT_TYPE,
  PROJECT_MOVED_EVENT_TYPE,
  projectArchivedEventDataSchema,
  projectMovedEventDataSchema,
} from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { makeReader } from "../../repositories/__tests__/support/authz-read.stub.ts";
import { AuthzAuditTrailRepository } from "../../repositories/authz-audit-trail.repository.ts";
import { AuthzGrantProjectionRepository } from "../../repositories/authz-grant-projection.repository.ts";
import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzLineageEpochRepository } from "../../repositories/memory/memory.authz-lineage-epoch.repository.ts";
import { AuthzScopeLineageService } from "../../services/authz-scope-lineage.service.ts";
import { EventingAuthzAdapter } from "../authz-grant.pipeline.ts";

const PROJECT_ID = "project_chatbot";
const ORGANIZATION_ID = "org_acme";

class NullAuthzGrantProjectionRepository extends AuthzGrantProjectionRepository {
  async append(): Promise<void> {}
}

class NullAuthzAuditTrailRepository extends AuthzAuditTrailRepository {
  async insert(): Promise<void> {}
}

/** Project's pipeline as its contract names the events; authz reads type and data. */
function projectStandIn() {
  return definePipeline({
    name: "project_stand_in",
    aggregate: defineAggregate({ type: "project" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(PROJECT_MOVED_EVENT_TYPE),
        data: projectMovedEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(PROJECT_ARCHIVED_EVENT_TYPE),
        data: projectArchivedEventDataSchema,
      }),
    ])
    .build();
}

function harness() {
  const memory = AuthzMemoryStore.create();
  const signal = MemoryAuthzLineageEpochRepository.create({ memory });
  const scopeLineage = AuthzScopeLineageService.create({
    repository: makeReader(),
    cacheEnabled: () => true,
    signal,
  });
  const eventing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
  const project = eventing.register(projectStandIn());
  eventing.register(
    EventingAuthzAdapter.build({
      authzGrantsWriteStore: new NullAuthzGrantProjectionRepository(),
      authzAuditTrailStore: new NullAuthzAuditTrailRepository(),
      scopeLineage,
    }),
  );
  const base = { tenantId: PROJECT_ID, projectId: PROJECT_ID, organizationId: ORGANIZATION_ID };
  const store = (id: string, occurredAt: number, fact: "moved" | "archived") =>
    project.service.storeEvents(
      [
        {
          id,
          aggregateId: PROJECT_ID,
          aggregateType: "project",
          tenantId: createTenantId(PROJECT_ID),
          version: "2026-10-06",
          createdAt: occurredAt,
          occurredAt,
          ...(fact === "moved"
            ? {
                type: PROJECT_MOVED_EVENT_TYPE,
                data: { ...base, occurredAt, fromTeamId: "team_alpha", toTeamId: "team_beta" },
              }
            : { type: PROJECT_ARCHIVED_EVENT_TYPE, data: { ...base, occurredAt } }),
        },
      ],
      { tenantId: createTenantId(PROJECT_ID) },
    );
  const signalOf = () => memory.lineageEpochs.get(ORGANIZATION_ID) ?? 0;

  return { eventing, store, signalOf };
}

describe("authz's lineage signal, moved from project's facts", () => {
  describe("when project records a move and then an archive", () => {
    /** @scenario "Project's moved and archived facts move the organization's lineage signal" */
    it("moves the organization's signal once per fact", async () => {
      const { eventing, store, signalOf } = harness();

      await store("event-moved", 10, "moved");
      await vi.waitFor(() => expect(signalOf()).toBe(1));
      await store("event-archived", 20, "archived");
      await vi.waitFor(() => expect(signalOf()).toBe(2));
      await eventing.close();
    });
  });
});

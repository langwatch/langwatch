/**
 * @vitest-environment node
 * A pipeline declares its tenants' retention from its owning module (ARCHITECTURE §9).
 * Spec: packages/eventing/specs/pipeline-retention.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import type { RetentionPolicy, RetentionPolicyResolver } from "../../runtime.types.ts";
import {
  createMockAppendStore,
  createMockEventStore,
  createMockMapProjectionDefinition,
  testEventSchema,
} from "../../services/__tests__/testHelpers.ts";

const pipelineEventSchema = testEventSchema("test.event", z.record(z.string(), z.unknown()));
type PipelineEvent = z.infer<typeof pipelineEventSchema>;

function eventFor(tenant: string): PipelineEvent {
  return {
    id: `event-${tenant}`,
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: createTenantId(tenant),
    type: "test.event",
    version: "2026-01-01",
    createdAt: 1,
    occurredAt: 1,
    data: {},
  };
}

function pipelineWith(retention?: RetentionPolicyResolver) {
  const store = createMockAppendStore<unknown>();
  const builder = definePipeline({
    name: "retained-pipeline",
    aggregate: defineAggregate({ type: "trace" }),
  })
    .withEvents([pipelineEventSchema])
    .withClickHouseMapProjection(
      createMockMapProjectionDefinition<PipelineEvent>("spanStorage", {
        eventTypes: ["test.event"],
        store,
      }),
    );
  const definition = (retention ? builder.withRetention(retention) : builder).build();
  return { definition, store };
}

function stampedRetention(store: ReturnType<typeof createMockAppendStore<unknown>>) {
  return vi.mocked(store.append).mock.calls.map(([, context]) => context.retentionPolicy ?? null);
}

const policies: Readonly<Record<string, RetentionPolicy>> = {
  "project-long": { traces: 365, scenarios: 30, experiments: 30 },
  "project-short": { traces: 7, scenarios: 30, experiments: 30 },
};

describe("a pipeline's declared retention", () => {
  beforeEach(() => {
    vi.stubEnv("BUILD_TIME", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("given a pipeline declaring its tenants' retention", () => {
    /** @scenario "A pipeline's rows take each tenant's retention from the pipeline's own resolver" */
    it("stamps each tenant's own retention on the rows its projections write", async () => {
      const resolve = vi.fn(async (tenantId: string) => policies[tenantId] ?? null);
      const { definition, store } = pipelineWith({ resolve });
      const eventSourcing = EventSourcing.createForTesting({
        eventStore: createMockEventStore<Event>(),
      });
      const pipeline = eventSourcing.register(definition);

      for (const tenant of ["project-long", "project-short"]) {
        await pipeline.service.storeEvents([eventFor(tenant)], {
          tenantId: createTenantId(tenant),
        });
      }

      expect(stampedRetention(store)).toEqual([
        policies["project-long"],
        policies["project-short"],
      ]);
      expect(resolve).toHaveBeenCalledWith("project-long");
      await eventSourcing.close();
    });

    /** @scenario "A pipeline's resolver wins over the runtime's" */
    it("asks the pipeline's resolver, never the runtime's", async () => {
      const runtime = { resolve: vi.fn(async () => policies["project-short"] ?? null) };
      const { definition, store } = pipelineWith({
        resolve: async () => policies["project-long"] ?? null,
      });
      const eventSourcing = EventSourcing.createWithStores({
        eventStore: createMockEventStore<Event>(),
        retentionPolicyResolver: runtime,
      });
      const pipeline = eventSourcing.register(definition);

      await pipeline.service.storeEvents([eventFor("project-long")], {
        tenantId: createTenantId("project-long"),
      });

      expect(stampedRetention(store)).toEqual([policies["project-long"]]);
      expect(runtime.resolve).not.toHaveBeenCalled();
      await eventSourcing.close();
    });
  });

  describe("given a pipeline declaring no retention in a runtime with none", () => {
    /** @scenario "A pipeline declaring no retention leaves its rows to the store's default" */
    it("hands its stores no policy, so each stamps its own default", async () => {
      const { definition, store } = pipelineWith();
      const eventSourcing = EventSourcing.createForTesting({
        eventStore: createMockEventStore<Event>(),
      });
      const pipeline = eventSourcing.register(definition);

      await pipeline.service.storeEvents([eventFor("project-long")], {
        tenantId: createTenantId("project-long"),
      });

      expect(stampedRetention(store)).toEqual([null]);
      await eventSourcing.close();
    });
  });

  describe("given a pipeline whose retention cannot be read", () => {
    /** @scenario "A projection whose tenant retention cannot be read writes no row with a guessed retention" */
    it("writes no row rather than stamping a default", async () => {
      const { definition, store } = pipelineWith({
        resolve: async () => {
          throw new Error("retention store unavailable");
        },
      });
      const eventSourcing = EventSourcing.createForTesting({
        eventStore: createMockEventStore<Event>(),
      });
      const pipeline = eventSourcing.register(definition);

      await pipeline.service
        .storeEvents([eventFor("project-long")], { tenantId: createTenantId("project-long") })
        .catch(() => undefined);

      expect(store.append).not.toHaveBeenCalled();
      await eventSourcing.close();
    });
  });
});

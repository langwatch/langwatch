/**
 * ADR-175: the span storage memory twin answers through the proof the way the ClickHouse reader
 * fences, so a process with no ClickHouse reads an aggregate's members, each inside its window.
 */
import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import type { SpanInsertData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemorySpanStorageRepository } from "../memory.span-storage.repository.ts";
import { MemoryTraceSpanStore } from "../memory.trace-span.store.ts";

const NOW = Date.now();
const GRANT_FROM = 1_700_000_000_000;
const TRACE = "trace-shared";

function span({
  tenantId,
  spanId,
  startTimeUnixMs,
}: {
  tenantId: string;
  spanId: string;
  startTimeUnixMs: number;
}): SpanInsertData {
  return {
    id: `projection-${spanId}`,
    tenantId,
    traceId: TRACE,
    spanId,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs,
    endTimeUnixMs: startTimeUnixMs + 50,
    durationMs: 50,
    name: `span-of-${tenantId}`,
    kind: 1,
    resourceAttributes: {},
    spanAttributes: {},
    statusCode: null,
    statusMessage: null,
    instrumentationScope: { name: "test", version: null },
    events: [{ name: `event-of-${spanId}`, timeUnixMs: startTimeUnixMs + 1, attributes: {} }],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    retentionDays: 7,
  };
}

async function repositoryHolding(): Promise<MemorySpanStorageRepository> {
  const repo = MemorySpanStorageRepository.create(MemoryTraceSpanStore.create());
  await repo.insertSpans([
    span({ tenantId: "aggregate", spanId: "agg-1", startTimeUnixMs: GRANT_FROM + 3 }),
  ]);
  await repo.insertSpans([
    span({ tenantId: "member", spanId: "member-before", startTimeUnixMs: GRANT_FROM - 1 }),
    span({ tenantId: "member", spanId: "member-after", startTimeUnixMs: GRANT_FROM + 1 }),
  ]);
  await repo.insertSpans([
    span({ tenantId: "outsider", spanId: "out-1", startTimeUnixMs: GRANT_FROM + 2 }),
  ]);
  return repo;
}

const aggregateReadsMember = () =>
  aggregateProof({
    projectId: "aggregate",
    members: [{ projectId: "member", from: GRANT_FROM }],
    now: NOW,
  });

describe("MemorySpanStorageRepository", () => {
  describe("given three tenants holding spans under one trace id", () => {
    describe("when an own-only proof reads the trace", () => {
      it("returns its own spans and no other tenant's", async () => {
        const repo = await repositoryHolding();

        const spans = await repo.findNormalizedSpansByTraceId({
          authorization: ownProof({ projectId: "outsider", now: NOW }),
          traceId: TRACE,
        });

        expect(spans.map((found) => found.spanId)).toEqual(["out-1"]);
      });
    });

    describe("when an aggregate's proof reads the trace", () => {
      it("returns its own spans and the member's inside the grant's window, in start order", async () => {
        const repo = await repositoryHolding();

        const spans = await repo.findNormalizedSpansByTraceId({
          authorization: aggregateReadsMember(),
          traceId: TRACE,
        });

        expect(spans.map((found) => found.spanId)).toEqual(["member-after", "agg-1"]);
      });

      it("returns only the events of the spans the proof reads", async () => {
        const repo = await repositoryHolding();

        const events = await repo.findTraceEventsByTraceId({
          authorization: aggregateReadsMember(),
          traceId: TRACE,
        });

        expect(events.map((event) => event.name)).toEqual([
          "event-of-member-after",
          "event-of-agg-1",
        ]);
      });

      it("finds a member's span by id inside the window and not one before it", async () => {
        const repo = await repositoryHolding();
        const read = (spanId: string) =>
          repo.findNormalizedSpanById({
            authorization: aggregateReadsMember(),
            traceId: TRACE,
            spanId,
            occurredAtMs: GRANT_FROM,
          });

        expect((await read("member-after"))?.tenantId).toBe("member");
        expect(await read("member-before")).toBeNull();
        expect(await read("out-1")).toBeNull();
      });
    });
  });
});

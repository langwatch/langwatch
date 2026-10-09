/**
 * The in-memory trace summaries answer a proof as the ClickHouse read does (ADR-175): the own
 * project outright, a member inside its grant's window, an outsider never.
 */
import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { createFoldState } from "../../../eventing/__tests__/trace-subscriber.fixtures.ts";
import { MemoryTraceSummaryRepository } from "../memory.trace-summary.repository.ts";

const NOW = 1_760_000_000_000;

function summaryAt({ traceId, anchorMs }: { traceId: string; anchorMs: number }): TraceSummaryData {
  return createFoldState({
    traceId,
    attributes: {},
    annotationIds: [],
    models: [],
    storageAnchorMs: anchorMs,
    occurredAt: anchorMs,
    createdAt: anchorMs,
    updatedAt: anchorMs,
    LastEventOccurredAt: anchorMs,
  });
}

async function seeded(): Promise<MemoryTraceSummaryRepository> {
  const repository = MemoryTraceSummaryRepository.create();
  await repository.upsert(summaryAt({ traceId: "shared", anchorMs: NOW }), "outsider");
  await repository.upsert(summaryAt({ traceId: "shared", anchorMs: NOW }), "member-b");
  await repository.upsert(summaryAt({ traceId: "shared", anchorMs: NOW }), "member-a");
  await repository.upsert(summaryAt({ traceId: "early", anchorMs: NOW - 10_000 }), "member-a");
  await repository.upsert(summaryAt({ traceId: "own", anchorMs: NOW }), "aggregate");
  return repository;
}

const aggregate = aggregateProof({
  projectId: "aggregate",
  members: [
    { projectId: "member-a", from: NOW - 1_000 },
    { projectId: "member-b", from: 0 },
  ],
  now: NOW,
});

describe("MemoryTraceSummaryRepository.findByTraceId", () => {
  describe("given a proof over an aggregate and two members", () => {
    it("reads the first member by tenant id and never the outsider", async () => {
      const repository = await seeded();

      const shared = await repository.findByTraceId({
        authorization: aggregate,
        traceId: "shared",
      });

      expect(shared?.tenantId).toBe("member-a");
    });

    it("leaves out a member's trace stored before its grant opens", async () => {
      const repository = await seeded();

      expect(await repository.findByTraceId({ authorization: aggregate, traceId: "early" })).toBe(
        null,
      );
    });

    it("reads the aggregate's own trace outright", async () => {
      const repository = await seeded();

      const own = await repository.findByTraceId({ authorization: aggregate, traceId: "own" });

      expect(own?.tenantId).toBe("aggregate");
    });
  });

  describe("given a plain project's own proof", () => {
    it("reads only that project's row", async () => {
      const repository = await seeded();
      const authorization = ownProof({ projectId: "outsider", now: NOW });

      const shared = await repository.findByTraceId({ authorization, traceId: "shared" });

      expect(shared?.tenantId).toBe("outsider");
      expect(await repository.findByTraceId({ authorization, traceId: "own" })).toBeNull();
    });
  });
});

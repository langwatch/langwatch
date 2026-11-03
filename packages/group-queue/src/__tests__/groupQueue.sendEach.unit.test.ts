/**
 * `sendEach` prepares every payload as `send` does and stages them in bounded batches, answering
 * each at its position. Staging is stubbed at the script boundary; real Redis is in
 * send-each.integration.test.ts. @see ../../specs/send-each.feature
 */

import { Redis as IORedis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { boundedStageBatches, sendPreparedInOrder } from "../boundedStaging.ts";
import type {
  GroupQueueContext,
  GroupQueueRuntimeDefinition,
  QueueAuditAdapter,
} from "../contracts.ts";
import { EnvelopeBlobLifecycle } from "../envelopeBlobLifecycle.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";
import { GroupStagingScripts, type StageBatchJob, type StagedJobOutcome } from "../scripts.ts";

type TestPayload = { id: string; groupId: string; occurredAt: number; __bad?: string };

const OCCURRED_AT = Date.now() - 60_000;

function auditAdapter(): QueueAuditAdapter<TestPayload> & {
  onEnqueue: ReturnType<typeof vi.fn>;
} {
  return {
    onEnqueue: vi.fn(async () => undefined),
    onLeased: async () => undefined,
    onDispatched: async () => undefined,
    onFailed: async () => undefined,
    onCompleted: async () => undefined,
  } as never;
}

function payload(id: string, over: Partial<TestPayload> = {}): TestPayload {
  return { id, groupId: `tenant-1/${id}`, occurredAt: OCCURRED_AT, ...over };
}

describe("GroupQueueProcessor.sendEach", () => {
  const connections: IORedis[] = [];

  function makeProcessor({
    audit,
    context,
    outcomesFor = (jobs) => jobs.map(() => "inserted"),
  }: {
    audit?: QueueAuditAdapter<TestPayload>;
    context?: GroupQueueContext;
    outcomesFor?: (jobs: readonly StageBatchJob[]) => StagedJobOutcome[];
  } = {}) {
    const conn = new IORedis({ lazyConnect: true, maxRetriesPerRequest: 0 });
    connections.push(conn);
    vi.spyOn(conn, "lpush").mockResolvedValue(1 as never);
    vi.spyOn(conn, "duplicate").mockReturnValue({ quit: vi.fn() } as never);
    vi.spyOn(GroupStagingScripts.prototype, "registerQueue").mockResolvedValue(undefined);
    const stageBatch = vi
      .spyOn(GroupStagingScripts.prototype, "stageBatch")
      .mockImplementation(async (jobs) => {
        const outcomes = outcomesFor(jobs);
        return {
          newStagedCount: outcomes.filter((outcome) => outcome === "inserted").length,
          orphanedValues: jobs.map(() => ""),
          outcomes,
        };
      });
    const stage = vi.spyOn(GroupStagingScripts.prototype, "stage");
    const definition: GroupQueueRuntimeDefinition<TestPayload> = {
      name: `{test/gq/send-each/${crypto.randomUUID().slice(0, 8)}}`,
      process: async () => {},
      groupKey: (each) => each.groupId,
      identify: (each) => each.id,
      score: (each) => each.occurredAt,
      deduplication: { makeId: (each) => each.id, ttlMs: 30_000 },
      auditAdapter: audit,
    };
    const processor = new GroupQueueProcessor<TestPayload>(definition, conn, {
      consumerEnabled: false,
      ...(context ? { context } : {}),
    });
    return { processor, stageBatch, stage };
  }

  afterEach(() => {
    for (const conn of connections.splice(0)) conn.disconnect();
    vi.restoreAllMocks();
  });

  describe("given payloads whose scores are equal", () => {
    /** @scenario A batch of single sends keeps each payload's own score */
    it("stages each at its own score plus the send's delay, with nothing added for position", async () => {
      const { processor, stageBatch, stage } = makeProcessor();

      await processor.sendEach([payload("a"), payload("b"), payload("c")], { delay: 500 });

      const [jobs] = stageBatch.mock.calls[0] ?? [];
      expect(jobs?.map((job) => job.dispatchAfterMs)).toEqual([
        OCCURRED_AT + 500,
        OCCURRED_AT + 500,
        OCCURRED_AT + 500,
      ]);
      expect(jobs?.map((job) => job.dedupId)).toEqual(["a", "b", "c"]);
      expect(stage).not.toHaveBeenCalled();
    });

    it("carries the caller's context on every job", async () => {
      const encode = vi.spyOn(EnvelopeBlobLifecycle.prototype, "encode");
      const { processor } = makeProcessor({
        context: { capture: () => ({ traceparent: "trace-ctx-1" }), run: (_, run) => run() },
      });

      await processor.sendEach([payload("a"), payload("b")]);

      expect(encode.mock.calls.map(([input]) => input.jobData.__context)).toEqual([
        expect.objectContaining({ traceparent: "trace-ctx-1" }),
        expect.objectContaining({ traceparent: "trace-ctx-1" }),
      ]);
    });
  });

  describe("given more payloads than one script call may carry", () => {
    /** @scenario A batch never carries more than 64 jobs or its byte ceiling in one script call */
    it("stages them in input order, in calls of at most 64 jobs", async () => {
      const { processor, stageBatch } = makeProcessor();
      const payloads = Array.from({ length: 130 }, (_, index) => payload(`p${index}`));

      const results = await processor.sendEach(payloads);

      expect(stageBatch.mock.calls.map(([jobs]) => jobs.length)).toEqual([64, 64, 2]);
      expect(stageBatch.mock.calls.flatMap(([jobs]) => jobs.map((job) => job.dedupId))).toEqual(
        payloads.map((each) => each.id),
      );
      expect(results).toHaveLength(130);
      expect(results.every((result) => result.status === "staged")).toBe(true);
    });
  });

  describe("given a batch where one payload cannot be prepared", () => {
    /** @scenario A payload the queue refuses fails alone */
    it("rejects that payload alone and stages the others", async () => {
      const { processor, stageBatch } = makeProcessor();

      const results = await processor.sendEach([
        payload("a"),
        payload("b", { __bad: "reserved" }),
        payload("c"),
      ]);

      expect(results.map((result) => result.status)).toEqual(["staged", "rejected", "staged"]);
      expect(stageBatch.mock.calls[0]?.[0].map((job) => job.dedupId)).toEqual(["a", "c"]);
    });
  });

  describe("given a batch where the queue squashes one payload into a job already staged", () => {
    /** @scenario A deduplicated payload is answered as deduplicated and opens no audit row */
    it("answers it as deduplicated and audits only the staged payloads", async () => {
      const audit = auditAdapter();
      const { processor } = makeProcessor({
        audit,
        outcomesFor: () => ["inserted", "deduplicated", "updated"],
      });

      const results = await processor.sendEach([payload("a"), payload("b"), payload("c")]);

      expect(results.map((result) => result.status)).toEqual(["staged", "deduplicated", "staged"]);
      expect(audit.onEnqueue.mock.calls.map(([event]) => event.payload.id)).toEqual(["a", "c"]);
    });
  });

  describe("given a script call that fails", () => {
    it("answers that call's payloads as unknown and still stages the next call", async () => {
      const { processor, stageBatch } = makeProcessor();
      stageBatch.mockRejectedValueOnce(new Error("connection reset"));
      const payloads = Array.from({ length: 65 }, (_, index) => payload(`p${index}`));

      const results = await processor.sendEach(payloads);

      expect(results.slice(0, 64).every((result) => result.status === "unknown")).toBe(true);
      expect(results[64]).toEqual({ status: "staged" });
    });
  });

  describe("given a queue whose drain has finished", () => {
    /** @scenario A batch of single sends is refused once the drain has finished */
    it("refuses the batch, naming the finished drain", async () => {
      const { processor, stageBatch } = makeProcessor();
      await processor.close();

      await expect(processor.sendEach([payload("a")])).rejects.toThrow(/drain has finished/);
      expect(stageBatch).not.toHaveBeenCalled();
    });
  });
});

describe("boundedStageBatches", () => {
  const job = (id: string, bytes: number) => ({ id, jobDataJson: "x".repeat(bytes) });

  describe("given jobs whose bodies outgrow the byte ceiling", () => {
    /** @scenario A batch never carries more than 64 jobs or its byte ceiling in one script call */
    it("closes a batch before the ceiling and sends an oversized job alone", () => {
      const batches = boundedStageBatches({
        jobs: [job("a", 40), job("b", 40), job("c", 40), job("big", 500), job("d", 10)],
        maxJobs: 64,
        maxBytes: 100,
      });

      expect(batches.map((batch) => batch.map((each) => each.id))).toEqual([
        ["a", "b"],
        ["c"],
        ["big"],
        ["d"],
      ]);
    });
  });
});

describe("sendPreparedInOrder", () => {
  describe("given inputs where one fails preparation", () => {
    it("rejects it at its position and answers the rest from the send, in order", async () => {
      const send = vi.fn(async (prepared: number[]) =>
        prepared.map((value) =>
          value === 3 ? { status: "deduplicated" as const } : { status: "staged" as const },
        ),
      );

      const results = await sendPreparedInOrder({
        inputs: [1, -1, 3],
        prepare: (value) => {
          if (value < 0) throw new Error("negative");
          return value;
        },
        send,
      });

      expect(send).toHaveBeenCalledWith([1, 3]);
      expect(results.map((result) => result.status)).toEqual([
        "staged",
        "rejected",
        "deduplicated",
      ]);
    });
  });

  describe("given a send that throws", () => {
    it("answers every prepared input as unknown", async () => {
      const results = await sendPreparedInOrder({
        inputs: ["a", "b"],
        prepare: (value) => value,
        send: async () => {
          throw new Error("lost");
        },
      });

      expect(results.map((result) => result.status)).toEqual(["unknown", "unknown"]);
    });
  });
});

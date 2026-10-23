/**
 * A command's `sendEach` validates each payload alone, routes the valid ones as `send` routes
 * them, and answers every payload at its position. Spec: specs/command-send-each.feature;
 * staging itself is the group queue's (packages/group-queue/specs/send-each.feature).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Command, CommandHandler } from "../../../commands/command.ts";
import { defineCommandSchema } from "../../../commands/commandSchema.ts";
import { sealCommandClass } from "../../../commands/sealedCommand.ts";
import type { CommandType } from "../../../domain/commandType.ts";
import type { Event } from "../../../domain/types.ts";
import type { EventSourcedQueueProcessor, QueueSendResult } from "../../../queues/index.ts";
import { createTestAggregateType, parseTestEvent } from "../../__tests__/testHelpers.ts";
import { type JobRegistryEntry, QueueManager } from "../queueManager.ts";

const payloadSchema = z.object({ tenantId: z.string(), aggregateId: z.string() });
type Payload = z.infer<typeof payloadSchema>;

class RecordThing implements CommandHandler<Command<Payload>, Event> {
  static readonly schema = defineCommandSchema("test.command.record" as CommandType, payloadSchema);

  static getAggregateId(payload: Payload): string {
    return payload.aggregateId;
  }

  async handle(): Promise<Event[]> {
    return [];
  }
}

function commandQueue(globalQueue: EventSourcedQueueProcessor<Record<string, unknown>>) {
  const manager = new QueueManager({
    parseEvent: parseTestEvent,
    aggregateType: createTestAggregateType(),
    pipelineName: "test-pipeline",
    globalQueue,
    globalJobRegistry: new Map<string, JobRegistryEntry>(),
  });
  manager.initializeCommandQueues(
    [
      sealCommandClass({
        name: "record",
        handlerClass: RecordThing,
        options: { deduplication: { makeId: (payload: Payload) => payload.aggregateId } },
      }),
    ],
    vi.fn(),
    "test-pipeline",
  );
  const queue = manager.getCommandQueue("record");
  if (!queue?.sendEach) throw new Error("the command facade has no sendEach");
  return { sendEach: queue.sendEach };
}

type SharedSendEach = NonNullable<EventSourcedQueueProcessor<Record<string, unknown>>["sendEach"]>;

function sharedQueue(
  sendEach?: EventSourcedQueueProcessor<Record<string, unknown>>["sendEach"],
): EventSourcedQueueProcessor<Record<string, unknown>> & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    waitUntilReady: vi.fn().mockResolvedValue(undefined),
    ...(sendEach ? { sendEach } : {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("QueueManager command facade sendEach", () => {
  describe("given a batch with one payload that fails the command schema", () => {
    /** @scenario "A payload that fails the command's schema is rejected alone" */
    it("rejects that payload alone and forwards the others, routed, to the shared queue", async () => {
      const forwarded = vi.fn<SharedSendEach>(async (payloads) =>
        payloads.map((): QueueSendResult => ({ status: "staged" })),
      );
      const { sendEach } = commandQueue(sharedQueue(forwarded));

      const results = await sendEach([
        { tenantId: "t1", aggregateId: "a1" },
        { tenantId: "t1" },
        { tenantId: "t1", aggregateId: "a3" },
      ]);

      expect(results.map((result) => result.status)).toEqual(["staged", "rejected", "staged"]);
      const [envelopes, options] = forwarded.mock.calls[0] ?? [];
      expect(envelopes?.map((envelope) => envelope.aggregateId)).toEqual(["a1", "a3"]);
      expect(envelopes?.[0]).toMatchObject({
        __pipelineName: "test-pipeline",
        __jobType: "command",
        __jobName: "record",
      });
      expect(options?.deduplication?.makeId(envelopes![1]!)).toBe(
        "test-pipeline/command/record/a3",
      );
    });
  });

  describe("given the shared queue answers some payloads as deduplicated or unknown", () => {
    /** @scenario "Each payload carries the queue's own answer at its position" */
    it("answers each payload with the queue's answer, at its position", async () => {
      const lost = new Error("reply lost");
      const { sendEach } = commandQueue(
        sharedQueue(async () => [{ status: "deduplicated" }, { status: "unknown", error: lost }]),
      );

      const results = await sendEach([
        { tenantId: "t1", aggregateId: "a1" },
        { tenantId: "t1", aggregateId: "a2" },
      ]);

      expect(results).toEqual([{ status: "deduplicated" }, { status: "unknown", error: lost }]);
    });
  });

  describe("given a shared queue without sendEach", () => {
    /** @scenario "A queue without batch sends takes the payloads one by one" */
    it("sends each payload in turn, a throw answering that payload as unknown", async () => {
      const queue = sharedQueue();
      queue.send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("down"));
      const { sendEach } = commandQueue(queue);

      const results = await sendEach([
        { tenantId: "t1", aggregateId: "a1" },
        { tenantId: "t1", aggregateId: "a2" },
      ]);

      expect(queue.send).toHaveBeenCalledTimes(2);
      expect(results.map((result) => result.status)).toEqual(["staged", "unknown"]);
    });
  });
});

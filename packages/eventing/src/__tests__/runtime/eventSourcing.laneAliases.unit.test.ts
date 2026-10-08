/**
 * @vitest-environment node
 * A successor lane consumes the key a previous release queued its jobs under (round 49 E4).
 * Spec: packages/eventing/specs/lane-alias.feature
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Command, CommandHandler } from "../../commands/command.ts";
import { defineCommandSchema } from "../../commands/commandSchema.ts";
import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import { EventSourcedQueueProcessorMemory } from "../../queues/memory.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";
import { type LaneAlias, laneAliasesPastWindow } from "../../upcast/laneAlias.ts";
import { EventUtils } from "../../utils/event.utils.ts";

const SPAN_RECEIVED = "lw.owner.span_received";
const ORIGIN_RESOLVED = "lw.owner.origin_resolved";
const NOTED = "lw.successor.noted";
const spanData = z.object({ spanId: z.string() });
const originData = z.object({ origin: z.string() });
const tenantId = createTenantId("project-1");

const notePayloadSchema = z.object({
  tenantId: z.string(),
  aggregateId: z.string(),
  note: z.string(),
});
const notedSchema = testEventSchema(NOTED, z.object({ note: z.string() }));
const notes: string[] = [];

class NoteCommand implements CommandHandler<
  Command<z.infer<typeof notePayloadSchema>>,
  z.infer<typeof notedSchema>
> {
  static readonly schema = defineCommandSchema("note", notePayloadSchema, "Record one note");

  static getAggregateId(payload: { aggregateId: string }): string {
    return payload.aggregateId;
  }

  handle(command: Command<{ aggregateId: string; note: string }>) {
    notes.push(command.data.note);
    return [
      EventUtils.createEvent<z.infer<typeof notedSchema>>({
        aggregateType: "successor",
        aggregateId: command.data.aggregateId,
        tenantId: createTenantId(command.tenantId),
        type: NOTED,
        version: "2026-10-08",
        data: { note: command.data.note },
        metadata: {},
      }),
    ];
  }
}

function alias(overrides: Partial<LaneAlias> & Pick<LaneAlias, "from" | "to">): LaneAlias {
  return { removeAfter: "3.21.0", ...overrides };
}

function runtime({ aliases }: { aliases: readonly LaneAlias[] }) {
  const spanSync = vi.fn(async (_data: z.infer<typeof spanData>) => undefined);
  const originSync = vi.fn(async (_data: z.infer<typeof originData>) => undefined);
  let exhausted: ((payload: Record<string, unknown>) => string) | undefined;
  const eventSourcing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    queueFactory: (definition) => {
      exhausted = (payload) => String(definition.onExhausted?.(payload));
      return new EventSourcedQueueProcessorMemory(definition);
    },
  });
  eventSourcing.register(
    definePipeline({ name: "owner", aggregate: defineAggregate({ type: "owner" }) })
      .withEvents([
        testEventSchema(SPAN_RECEIVED, spanData),
        testEventSchema(ORIGIN_RESOLVED, originData),
      ])
      .build(),
  );
  eventSourcing.register(
    definePipeline({ name: "successor", aggregate: defineAggregate({ type: "successor" }) })
      .withEvents([notedSchema])
      .withCommand("note", NoteCommand)
      .withPeerSubscriber("spanSync", {
        eventType: SPAN_RECEIVED,
        data: spanData,
        handle: spanSync,
      })
      .withPeerSubscriber("originSync", {
        eventType: ORIGIN_RESOLVED,
        data: originData,
        handle: originSync,
      })
      .withLaneAliases(aliases)
      .build(),
  );
  eventSourcing.startConsumers();
  return { eventSourcing, spanSync, originSync, onExhausted: () => exhausted };
}

function ownerEvent({ id, type, data }: { id: string; type: string; data: object }): Event {
  return {
    id,
    aggregateId: "trace-a",
    aggregateType: "owner",
    tenantId,
    type,
    version: "2026-10-08",
    createdAt: 10,
    occurredAt: 10,
    data,
  };
}

const span = ownerEvent({ id: "e1", type: SPAN_RECEIVED, data: { spanId: "s1" } });
const origin = ownerEvent({ id: "e2", type: ORIGIN_RESOLVED, data: { origin: "sdk" } });

/** A job as the previous release queued it: its body under its key, and no `__routing`. */
async function sendQueuedByPreviousRelease({
  eventSourcing,
  key,
  body,
}: {
  eventSourcing: EventSourcing;
  key: string;
  body: Record<string, unknown>;
}): Promise<void> {
  const [pipeline, jobType, ...name] = key.split(":");
  await eventSourcing.globalQueue?.send({
    ...body,
    __pipelineName: pipeline,
    __jobType: jobType,
    __jobName: name.join(":"),
  });
}

const splitAliases = [
  alias({
    from: "owner:reactor:triggerMatch",
    to: { jobType: "subscriber", lane: "spanSync" },
    eventTypes: [SPAN_RECEIVED],
  }),
  alias({
    from: "owner:reactor:triggerMatch",
    to: { jobType: "subscriber", lane: "originSync" },
    eventTypes: [ORIGIN_RESOLVED],
  }),
];

describe("a successor lane's aliases", () => {
  describe("given a subscriber job queued under a renamed key", () => {
    /** @scenario "A subscriber job queued under a renamed key is processed by its successor" */
    it("hands the event to the successor's peer subscriber once", async () => {
      const { eventSourcing, spanSync } = runtime({
        aliases: [
          alias({
            from: "owner:subscriber:spanSync",
            to: { jobType: "subscriber", lane: "spanSync" },
          }),
        ],
      });

      await sendQueuedByPreviousRelease({
        eventSourcing,
        key: "owner:subscriber:spanSync",
        body: { ...span },
      });

      await vi.waitFor(() => expect(spanSync).toHaveBeenCalledTimes(1));
      expect(spanSync.mock.calls[0]?.[0]).toEqual({ spanId: "s1" });
      await eventSourcing.close();
    });
  });

  describe("given a reactor job queued under a former key", () => {
    /** @scenario "A reactor job queued under a former key reaches its successor with the event it carried" */
    it("hands the successor the event out of the reactor's body", async () => {
      const { eventSourcing, spanSync } = runtime({
        aliases: [
          alias({
            from: "owner:reactor:spanSync",
            to: { jobType: "subscriber", lane: "spanSync" },
          }),
        ],
      });

      await sendQueuedByPreviousRelease({
        eventSourcing,
        key: "owner:reactor:spanSync",
        body: { event: span, foldState: { spans: 1 } },
      });

      await vi.waitFor(() =>
        expect(spanSync).toHaveBeenCalledWith({ spanId: "s1" }, expect.anything()),
      );
      await eventSourcing.close();
    });
  });

  describe("given a former lane split across two successors", () => {
    /** @scenario "A former lane split across successors reaches the one that takes its event type" */
    it("routes the job to the successor that takes its event type", async () => {
      const { eventSourcing, spanSync, originSync } = runtime({ aliases: splitAliases });

      await sendQueuedByPreviousRelease({
        eventSourcing,
        key: "owner:reactor:triggerMatch",
        body: { event: origin, foldState: null },
      });

      await vi.waitFor(() => expect(originSync).toHaveBeenCalledTimes(1));
      expect(spanSync).not.toHaveBeenCalled();
      await eventSourcing.close();
    });
  });

  describe("given a former job body the successor does not read", () => {
    /** @scenario "A former job body the successor does not read is upcast by the alias" */
    it("runs the successor's command with the transformed body", async () => {
      notes.length = 0;
      const { eventSourcing } = runtime({
        aliases: [
          alias({
            from: "owner:job:deferredSync",
            to: { jobType: "command", lane: "note" },
            data: (stored) => {
              const { projectId, traceId } = z
                .object({ projectId: z.string(), traceId: z.string() })
                .parse(stored);
              return { tenantId: projectId, aggregateId: traceId, note: `deferred ${traceId}` };
            },
          }),
        ],
      });

      await sendQueuedByPreviousRelease({
        eventSourcing,
        key: "owner:job:deferredSync",
        body: { projectId: "project-1", traceId: "trace-a" },
      });

      await vi.waitFor(() => expect(notes).toEqual(["deferred trace-a"]));
      await eventSourcing.close();
    });
  });

  describe("given an aliased job whose event type no successor takes", () => {
    /** @scenario "An aliased job whose event type no successor takes is acknowledged with a log line" */
    it("acknowledges it and runs no handler", async () => {
      const { eventSourcing, spanSync, originSync } = runtime({
        aliases: splitAliases.slice(0, 1),
      });

      await expect(
        sendQueuedByPreviousRelease({
          eventSourcing,
          key: "owner:reactor:triggerMatch",
          body: { event: origin, foldState: null },
        }),
      ).resolves.toBeUndefined();
      expect(spanSync).not.toHaveBeenCalled();
      expect(originSync).not.toHaveBeenCalled();
      await eventSourcing.close();
    });
  });

  describe("given a job under a key no alias names", () => {
    /** @scenario "A job under a key no alias names still retries and blocks" */
    it("rejects it for retry, and blocks its group once spent", async () => {
      const { eventSourcing, spanSync, onExhausted } = runtime({ aliases: splitAliases });
      const body = { ...span, __pipelineName: "owner", __jobType: "subscriber", __jobName: "gone" };

      await expect(
        sendQueuedByPreviousRelease({
          eventSourcing,
          key: "owner:subscriber:gone",
          body: { ...span },
        }),
      ).rejects.toMatchObject({ name: "QueueError" });
      expect(spanSync).not.toHaveBeenCalled();
      expect(onExhausted()?.(body)).toBe("block");
      await eventSourcing.close();
    });
  });

  describe("when a pipeline declares an alias that could never apply", () => {
    const build = (aliases: readonly LaneAlias[]) => () =>
      definePipeline({ name: "successor", aggregate: defineAggregate({ type: "successor" }) })
        .withEvents([notedSchema])
        .withLaneAliases(aliases);

    /** @scenario "An alias that could never apply is refused when the pipeline is built" */
    it("refuses a key that is not pipeline, job type and name", () => {
      expect(
        build([alias({ from: "owner:spanSync", to: { jobType: "subscriber", lane: "spanSync" } })]),
      ).toThrow(/Pipeline "successor" aliases "owner:spanSync"/);
    });

    /** @scenario "An alias that could never apply is refused when the pipeline is built" */
    it("refuses an alias to its own current key", () => {
      expect(
        build([
          alias({ from: "successor:command:note", to: { jobType: "command", lane: "note" } }),
        ]),
      ).toThrow(/aliases "successor:command:note" to itself/);
    });

    /** @scenario "An alias that could never apply is refused when the pipeline is built" */
    it("refuses two aliases taking one event type from one key", () => {
      expect(
        build([splitAliases[0]!, { ...splitAliases[1]!, eventTypes: [SPAN_RECEIVED] }]),
      ).toThrow(/twice for the event type "lw.owner.span_received"/);
    });

    /** @scenario "An alias that could never apply is refused when the pipeline is built" */
    it("refuses an alias with no release that ends it", () => {
      expect(build([{ ...splitAliases[0]!, removeAfter: "next" }])).toThrow(
        /no release that ends it/,
      );
    });
  });

  describe("given an alias that ends after release 3.21.0", () => {
    const declared = [{ pipeline: "successor", aliases: splitAliases.slice(0, 1) }];

    /** @scenario "An alias past its release is refused so it gets removed" */
    it("names it once 3.21.0 or later has been cut", () => {
      for (const newestRelease of ["3.21.0", "3.21.1", "4.0.0"]) {
        expect(laneAliasesPastWindow({ declared, newestRelease })).toEqual([
          { pipeline: "successor", from: "owner:reactor:triggerMatch", removeAfter: "3.21.0" },
        ]);
      }
    });

    /** @scenario "An alias past its release is refused so it gets removed" */
    it("names nothing before that release", () => {
      expect(laneAliasesPastWindow({ declared, newestRelease: "3.20.1" })).toEqual([]);
    });
  });
});

/**
 * @vitest-environment node
 * An older worker retries a queued event type it does not declare (rolling-deploy drain, §9).
 * Spec: packages/eventing/specs/undeclared-event-drain.feature
 */
import { NonRetryableGroupQueueError } from "@langwatch/group-queue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { ErrorCategory, UndeclaredQueuedEventTypeError } from "../../services/errorHandling.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";

const OLD_TYPE = "lw.owner.registered";
const NEW_TYPE = "lw.owner.created";
const ownerData = z.object({ ownerId: z.string() });

/** The owner and its peer reactor as one release declares them: same lane, that release's type. */
function release({ eventType, handle }: { eventType: string; handle: (ownerId: string) => void }) {
  const owner = definePipeline({
    name: "owner_lifecycle",
    aggregate: defineAggregate({ type: "owner" }),
  })
    .withEvents([testEventSchema(eventType, ownerData)])
    .build();
  const reactor = definePipeline({
    name: "reactor",
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerSubscriber("onOwnerCreated", {
      eventType,
      data: ownerData,
      handle: async (data) => handle(data.ownerId),
    })
    .build();
  const eventSourcing = EventSourcing.createWithStores({
    eventStore: EventStoreMemory.createForTesting(),
  });
  eventSourcing.register(owner);
  eventSourcing.register(reactor);
  eventSourcing.startConsumers();
  return eventSourcing;
}

function event({ type = NEW_TYPE }: { type?: unknown } = {}): Omit<Event, "type"> & {
  type: unknown;
} {
  return {
    id: "event-owner-1",
    aggregateId: "owner-1",
    aggregateType: "owner",
    tenantId: createTenantId("project-1"),
    type,
    version: "2026-10-08",
    createdAt: 1,
    occurredAt: 1,
    data: { ownerId: "owner-1" },
  };
}

/** Sends the peer-subscriber job as the newer release staged it, under the lane's registry key. */
async function dequeue({
  eventSourcing,
  payload,
}: {
  eventSourcing: EventSourcing;
  payload: Record<string, unknown>;
}): Promise<void> {
  const key = [...eventSourcing.globalJobRegistry.keys()].find((name) =>
    name.endsWith(".onOwnerCreated"),
  );
  const [pipelineName, jobType, ...jobName] = (key ?? "").split(":");
  await eventSourcing.globalQueue?.send({
    ...payload,
    __pipelineName: pipelineName,
    __jobType: jobType,
    __jobName: jobName.join(":"),
  });
}

async function failureOf(run: Promise<void>): Promise<unknown> {
  return run.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("a peer-subscriber job carrying an event type the worker does not declare", () => {
  const runtimes: EventSourcing[] = [];
  const open = (eventSourcing: EventSourcing) => (runtimes.push(eventSourcing), eventSourcing);

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((eventSourcing) => eventSourcing.close()));
  });

  /** @scenario "An older worker retries a peer-subscriber job whose event type it does not declare" */
  it("fails retryably on the older worker, naming the type, without running the handler", async () => {
    const handled = vi.fn();
    const older = open(release({ eventType: OLD_TYPE, handle: handled }));

    const error = await failureOf(dequeue({ eventSourcing: older, payload: event() }));

    expect(error).toBeInstanceOf(UndeclaredQueuedEventTypeError);
    expect(error).toMatchObject({ eventType: NEW_TYPE, category: ErrorCategory.RECOVERABLE });
    expect(error).not.toBeInstanceOf(NonRetryableGroupQueueError);
    expect(handled).not.toHaveBeenCalled();
  });

  /** @scenario "A retried job is taken by a worker that declares the type" */
  it("runs the handler when a worker of the newer release takes the same job", async () => {
    const payload = event();
    const older = open(release({ eventType: OLD_TYPE, handle: vi.fn() }));
    await expect(dequeue({ eventSourcing: older, payload })).rejects.toBeInstanceOf(
      UndeclaredQueuedEventTypeError,
    );

    const handled = vi.fn();
    const newer = open(release({ eventType: NEW_TYPE, handle: handled }));
    await dequeue({ eventSourcing: newer, payload });

    expect(handled).toHaveBeenCalledWith("owner-1");
  });

  /** @scenario "A type still undeclared when the retries are spent is exhausted with a named reason" */
  it("fails retryably on every attempt with the type in the reason the queue stores", async () => {
    const older = open(release({ eventType: OLD_TYPE, handle: vi.fn() }));

    const failures = [
      await failureOf(dequeue({ eventSourcing: older, payload: event() })),
      await failureOf(dequeue({ eventSourcing: older, payload: event() })),
    ];

    for (const failure of failures) {
      expect(failure).not.toBeInstanceOf(NonRetryableGroupQueueError);
      expect(failure).not.toHaveProperty("retryable", false);
      expect(failure).toHaveProperty("message", expect.stringContaining(`"${NEW_TYPE}"`));
    }
  });

  /** @scenario "A queued event with no type at all is still refused as invalid" */
  it("refuses an event with no type non-retryably", async () => {
    const older = open(release({ eventType: OLD_TYPE, handle: vi.fn() }));

    const error = await failureOf(
      dequeue({ eventSourcing: older, payload: event({ type: null }) }),
    );

    expect(error).toMatchObject({ name: "QueuedPayloadInvalidError" });
    expect(error).toBeInstanceOf(NonRetryableGroupQueueError);
  });
});

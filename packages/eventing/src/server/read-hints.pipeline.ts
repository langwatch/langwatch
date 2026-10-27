import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import { defineAggregate } from "../domain/definitions.ts";
import type { Event } from "../domain/types.ts";
/**
 * The one framework subscriber turning committed events into read hints (record §10, "Server
 * events say when a read is stale"): `{ path }` on the framework's read-hint channel, under the
 * event's tenant or the field its read named. Spec: packages/api/specs/read-hints.feature.
 */
import type { ReadHintMap, ReadHintTarget } from "../pipeline/feature-eventing.ts";
import { definePipeline } from "../pipeline/staticBuilder.ts";
import { ConfigurationError } from "../services/errorHandling.ts";

/** The framework's own channel hints travel on; presence relays it to browsers (record §3.3). */
export const READ_HINT_BROADCAST_CHANNEL = "eventing:read_invalidated";

/** A burst of one event for one tenant waits this long and publishes once. */
export const READ_HINT_COALESCE_MS = 1_000;

/** The process's own Redis publish. */
export type ReadHintPublish = (channel: string, message: string) => Promise<unknown>;

const eventDataSchema = z.record(z.string(), z.unknown());

/** The tenant a read's hint goes to, or nothing when the event lacks the field it names. */
function tenantOf({
  target,
  data,
  tenantId,
}: {
  target: ReadHintTarget;
  data: Readonly<Record<string, unknown>>;
  tenantId: string;
}): string | undefined {
  if (target.scope === void 0) return tenantId;
  const value = data[target.scope];
  return typeof value === "string" && value.length > 0 ? value : void 0;
}

/** One publish per distinct read and tenant; a refused publish throws so the lane retries. */
export async function publishReadHints({
  targets,
  data,
  tenantId,
  publish,
}: {
  targets: readonly ReadHintTarget[];
  data: Readonly<Record<string, unknown>>;
  tenantId: string;
  publish: ReadHintPublish;
}): Promise<void> {
  const hints = new Map<string, { path: string; tenantId: string }>();
  for (const target of targets) {
    const tenant = tenantOf({ target, data, tenantId });
    if (tenant !== void 0)
      hints.set(`${target.path}\n${tenant}`, { path: target.path, tenantId: tenant });
  }
  for (const hint of hints.values()) {
    await publish(
      READ_HINT_BROADCAST_CHANNEL,
      JSON.stringify({
        tenantId: hint.tenantId,
        event: JSON.stringify({ path: hint.path }),
        timestamp: nowInstant().epochMilliseconds,
      }),
    );
  }
}

/** One event type's burst for one set of hinted tenants shares a job. */
export function readHintDedupId({
  eventType,
  targets,
  event,
}: {
  eventType: string;
  targets: readonly ReadHintTarget[];
  event: Pick<Event, "tenantId" | "data">;
}): string {
  const data = eventDataSchema.safeParse(event.data);
  const tenants = targets.map((target) =>
    tenantOf({ target, data: data.success ? data.data : {}, tenantId: event.tenantId }),
  );
  return `${eventType}:${tenants.join(",")}`;
}

/**
 * Refuses a read naming an event no installed pipeline declares, then builds one peer subscriber
 * per hinted event on a `global` pipeline that appends nothing.
 */
export function createReadHintsPipeline({
  hinted,
  declaredEventTypes,
  publish,
}: {
  hinted: ReadHintMap;
  declaredEventTypes: ReadonlySet<string>;
  publish: ReadHintPublish;
}) {
  const unknown = [...hinted].filter(([eventType]) => !declaredEventTypes.has(eventType));
  if (unknown.length > 0) {
    throw new ConfigurationError(
      "ReadHints",
      `A read names an event no installed pipeline declares: ${unknown
        .map(
          ([eventType, targets]) => `${eventType} (${targets.map(({ path }) => path).join(", ")})`,
        )
        .join("; ")}`,
      { eventTypes: unknown.map(([eventType]) => eventType) },
    );
  }

  let pipeline = definePipeline({
    name: "read_hints",
    aggregate: defineAggregate({ type: "global" }),
  }).withEvents([]);
  for (const [eventType, targets] of hinted) {
    pipeline = pipeline.withPeerSubscriber(`on_${eventType.replaceAll(".", "_")}`, {
      eventType,
      data: eventDataSchema,
      handle: (data, context) =>
        publishReadHints({ targets, data, tenantId: context.tenantId, publish }),
      options: {
        delay: READ_HINT_COALESCE_MS,
        deduplication: {
          makeId: (event) => readHintDedupId({ eventType, targets, event }),
          ttlMs: READ_HINT_COALESCE_MS,
        },
      },
    });
  }
  return pipeline.build();
}

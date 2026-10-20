// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  Event,
  ParsingSchema,
  PeerSubscriberBatchItem,
  PeerBatchSubscriberDefinition,
} from "@langwatch/eventing";

/** Most of one project's backed-up facts a lane takes in one step. */
export const NURTURING_BATCH_MAX = 200;

/**
 * A peer lane for a fact a project can raise faster than nurturing can send one at a time.
 * Each lane queues per project, never per owner aggregate, so a backed-up project's facts are
 * drained together (ADR-066) and handled in one step; an idle project's fact is a batch of one.
 * The handler stays idempotent per item: the queue splits a failed batch and retries the halves.
 */
export function nurturingBatchLane<Data extends ParsingSchema>({
  eventType,
  data,
  handleBatch,
}: Readonly<{
  eventType: string;
  data: Data;
  handleBatch: (items: readonly PeerSubscriberBatchItem<Data>[]) => Promise<void>;
}>): PeerBatchSubscriberDefinition<Data> {
  return {
    eventType,
    data,
    handleBatch,
    options: {
      groupKeyFn: (event: Event) => `nurturing-batch:${event.tenantId}`,
      coalesceMaxBatch: NURTURING_BATCH_MAX,
    },
  };
}

import type { ClickHouseClient } from "@langwatch/clickhouse";
import {
  type AggregateEvent,
  createFoldExecutor,
  createMapExecutor,
  type Metrics,
} from "@langwatch/event-sourcing";
import { experimentRun } from "./aggregate";
import { mapEvaluatorResult, mapTargetResult } from "./itemsMapping";
import { createExperimentRunItemsStore } from "./itemsStore";
import { assertExperimentRunProcessingMountsAreLegal } from "./mount";
import type {
  EvaluatorResultData,
  ExperimentRunItemRecord,
  TargetResultData,
} from "./schema";
import { createExperimentRunsStore } from "./store";

/**
 * The two projection executors this pipeline exposes (ADR-098, ADR-105 §6).
 *
 * As in `log-processing/projection.ts`, there is deliberately no
 * `withFold`/`withMap` builder call here — that mount point lives in
 * `pipeline.ts` under ADR-102's static pipeline builder, which no pipeline in
 * this tree has been wired onto yet. What this module exposes is what a
 * future composition root needs: each executor pre-wired to its store, with
 * both mounts validated eagerly (`mount.ts`) rather than left for the
 * builder to discover wrong.
 */

const FOLD_PROJECTION_NAME = "experimentRunState";
const MAP_PROJECTION_NAME = "experimentRunResultStorage";

/**
 * `@langwatch/event-sourcing`'s bare `AggregateEvent` is `{ type, data }`
 * only — no tenant id, matching every other rewritten pipeline in this tree.
 * `itemsMapping.ts`'s functions need `tenantId` to compute `ProjectionId`
 * (ADR-103 decision 2's fix folds it into the hash), so the map projection
 * needs a richer event shape, exactly as `billing-reporting`'s
 * `BillableSourceEvent` does for the same reason. A future dispatch runtime
 * supplies this from whatever envelope it reads events out of; nothing here
 * assumes where that envelope comes from beyond the two fields used.
 */
export interface ExperimentRunSourceEvent extends AggregateEvent {
  readonly tenantId: string;
}

/**
 * The event keys `experimentRun.events` declares — `keyof`, not a
 * hand-retyped string union, so a rename in `aggregate.ts` is a compile error
 * here rather than a dispatch table silently going stale.
 */
type ExperimentRunEventKey = keyof typeof experimentRun.events;

/**
 * The two events this projection turns into an item row, keyed by event key
 * rather than by a reconstructed type-string literal. Reconstructing
 * `` `${experimentRun.name}/targetResultRecorded` `` by hand here would
 * duplicate the key `aggregate.ts`'s `.events({...})` call already owns —
 * exactly the "hand-maintained event-type map" this pipeline's declaration
 * exists to make unnecessary (ADR-105).
 */
const ITEM_HANDLERS: Partial<
  Record<
    ExperimentRunEventKey,
    (args: {
      readonly tenantId: string;
      readonly data: unknown;
    }) => ExperimentRunItemRecord
  >
> = {
  targetResultRecorded: (args) =>
    mapTargetResult({
      tenantId: args.tenantId,
      data: args.data as TargetResultData,
    }),
  evaluatorResultRecorded: (args) =>
    mapEvaluatorResult({
      tenantId: args.tenantId,
      data: args.data as EvaluatorResultData,
    }),
};

/**
 * Recovers the event key `ITEM_HANDLERS` is keyed by from a derived type
 * string (`${name}/${key}`), stripping the aggregate's own `name` rather
 * than a hand-duplicated prefix literal.
 */
function eventKeyOf(type: string): ExperimentRunEventKey | undefined {
  const prefix = `${experimentRun.name}/`;
  return type.startsWith(prefix)
    ? (type.slice(prefix.length) as ExperimentRunEventKey)
    : undefined;
}

export function createExperimentRunStateProjection(args: {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
}): ReturnType<
  typeof createFoldExecutor<
    ReturnType<typeof experimentRun.init>,
    AggregateEvent
  >
> {
  assertExperimentRunProcessingMountsAreLegal();

  const store = createExperimentRunsStore({
    client: args.client,
    expectedVersion: experimentRun.stateVersion,
  });

  return createFoldExecutor({
    store,
    init: experimentRun.init,
    apply: experimentRun.apply,
    stateVersion: experimentRun.stateVersion,
    projectionName: FOLD_PROJECTION_NAME,
    metrics: args.metrics,
  });
}

export function createExperimentRunResultStorageProjection(args: {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
}): ReturnType<
  typeof createMapExecutor<ExperimentRunSourceEvent, ExperimentRunItemRecord>
> {
  assertExperimentRunProcessingMountsAreLegal();

  const store = createExperimentRunItemsStore({ client: args.client });

  return createMapExecutor<ExperimentRunSourceEvent, ExperimentRunItemRecord>({
    store,
    map: (event) => {
      const key = eventKeyOf(event.type);
      const handler = key ? ITEM_HANDLERS[key] : undefined;
      return handler
        ? handler({ tenantId: event.tenantId, data: event.data })
        : null;
    },
    projectionName: MAP_PROJECTION_NAME,
    metrics: args.metrics,
  });
}

/**
 * Trace maps log's record fact into its own `stored_log_records` (D-LOG, round 22), so trace's
 * log reads hold no log peer. Spec: modules/trace/specs/trace-log-record-storage.feature
 */
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  canonicalLogRecordSchema,
} from "@langwatch/log-contract";

import type { TraceModule } from "../app/trace.app.ts";
import type { LogRecordStorageRepository } from "../repositories/log-record-storage.repository.ts";
import { TraceLogRecordStorageMapProjection } from "./trace-log-record-storage.projection.ts";
import { TraceLogRecordStorageStore } from "./trace-log-record-storage.store.ts";

export const TRACE_LOG_RECORDS_PIPELINE_NAME = "trace_log_records" as const;

/** The replayable lane, `<pipeline>.<projection>`, an operator or a replay step rebuilds. */
export const TRACE_LOG_RECORD_STORAGE_LANE =
  `${TRACE_LOG_RECORDS_PIPELINE_NAME}.traceLogRecordStorage` as const;

const LOG_RECORD_FACTS = [
  { type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE, data: canonicalLogRecordSchema },
] as const;

function traceLogRecordsHost({ store }: { store: TraceLogRecordStorageStore }) {
  return definePipeline({
    name: TRACE_LOG_RECORDS_PIPELINE_NAME,
    // `global`: trace appends no events of its own here; it only maps log's.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerMapProjection({
      events: LOG_RECORD_FACTS,
      map: TraceLogRecordStorageMapProjection.create({ store }),
    });
}

export type TraceLogRecordsPipeline = ReturnType<ReturnType<typeof traceLogRecordsHost>["build"]>;

export function buildTraceLogRecordsPipeline({
  repository,
  retention,
}: {
  repository: LogRecordStorageRepository;
  retention: Pick<DataRetentionApi, "getPlatformDefaultRetentionDays" | "getResolvedForProject">;
}): TraceLogRecordsPipeline {
  return traceLogRecordsHost({
    store: TraceLogRecordStorageStore.create({
      storage: repository,
      defaultRetentionDays: () => retention.getPlatformDefaultRetentionDays(),
    }),
  })
    .withRetention({
      resolve: (tenantId) => retention.getResolvedForProject({ projectId: tenantId }),
    })
    .build();
}

export const traceLogRecordsEventing = defineEventingModule({
  pipeline: TRACE_LOG_RECORDS_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, TraceModule>) => app.logRecordsPipeline(),
});

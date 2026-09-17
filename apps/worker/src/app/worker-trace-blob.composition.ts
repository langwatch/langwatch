import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { Logger } from "@langwatch/observability";
import type { StoredObjectStorageRuntimeAdapter } from "@langwatch/stored-object-server";
import {
  createTracePayloadReader,
  TraceSpanSpoolAdapter,
  TraceSpoolService,
  type TracePayloadReaderRepository,
  type TraceClickHouseResolver,
  type TraceSpanSpool,
} from "@langwatch/trace-server";
import {
  WorkerTraceSpoolLegacyObjectAdapter,
  WorkerTraceSpoolStorageAdapter,
} from "../platform/infrastructure/worker-trace-spool.adapter.ts";

/**
 * Staged but not mounted; builds the claim check from stored objects, AWS, and
 * ClickHouse.
 */
export function createWorkerTraceSpool(options: {
  runtime: StoredObjectStorageRuntimeAdapter;
  aws: AwsClientProcessRuntime;
  azureRetentionConfirmed: boolean;
  logger?: Logger;
}): TraceSpanSpool {
  return TraceSpanSpoolAdapter.create(
    TraceSpoolService.create({
      storage: WorkerTraceSpoolStorageAdapter.create({
        runtime: options.runtime,
        aws: options.aws,
        azureRetentionConfirmed: options.azureRetentionConfirmed,
      }),
      legacyObjects: WorkerTraceSpoolLegacyObjectAdapter.create({
        runtime: options.runtime,
        aws: options.aws,
      }),
      ...(options.logger ? { logger: options.logger } : {}),
    }),
  );
}

/** The durable half: one offloaded field, recalled out of its own event_log row. */
export function createWorkerTracePayloadReader(options: {
  resolveClickHouseClient: TraceClickHouseResolver;
}): TracePayloadReaderRepository {
  return createTracePayloadReader(options);
}

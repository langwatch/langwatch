import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { Logger } from "@langwatch/observability";
import type { StoredObjectStorageRuntime } from "@langwatch/stored-object-server/storage";
import {
  ClickHouseTracePayloadReaderAdapter,
  TraceSpanSpoolAdapter,
  TraceSpoolService,
  type TracePayloadReaderPort,
  type TraceClickHouseResolver,
  type TraceSpanSpoolPort,
} from "@langwatch/trace-server";
import {
  WorkerTraceSpoolLegacyObjectAdapter,
  WorkerTraceSpoolStorageAdapter,
} from "../platform/infrastructure/worker-trace-spool.adapter";

/**
 * The ADR-022 claim check this process would resolve an oversized span through.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still owns
 * `RecordSpanCommand`'s adapters and still resolves every spooled span it
 * ingests — so nothing in this process reads a spool object yet. What has to be
 * true today is that this composition root CAN build both halves of the claim
 * check from substrates it already holds: the stored-objects runtime the
 * private-infrastructure root already constructs, the AWS client runtime beside
 * it, the tenant-keyed ClickHouse client the event store resolves through, and
 * one new boolean the operator sets on Azure.
 *
 * The two halves are independent and are deliberately composed separately:
 *
 *     TraceSpanSpoolPort                (trace-server declares it)
 *       └─ TraceSpoolService            re-derives the object path from the
 *            └─ TraceSpoolStoragePort     command's own trusted ids, never
 *                 └─ stored objects       from the reference it carries
 *
 *     TracePayloadReaderPort            (trace-server declares it)
 *       └─ event_log SELECT             TenantId first, EventId-derived
 *            └─ ClickHouse                partition window, absence -> null
 *
 * The spool is transient and the event log is durable; a process that can read
 * one and not the other still ingests, which is why neither factory requires
 * the other's dependencies.
 */
export function createWorkerTraceSpool(options: {
  runtime: StoredObjectStorageRuntime;
  aws: AwsClientProcessRuntime;
  azureRetentionConfirmed: boolean;
  logger?: Logger;
}): TraceSpanSpoolPort {
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
}): TracePayloadReaderPort {
  return ClickHouseTracePayloadReaderAdapter.create({
    resolveClient: options.resolveClickHouseClient,
  });
}

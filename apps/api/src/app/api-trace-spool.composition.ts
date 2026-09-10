/**
 * The ADR-022 write half: the edge size check, and the transient spool of a
 * payload still over the inline threshold after the media extraction in front
 * of it ran. The queue then carries a reference the worker reads back.
 */
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { Logger } from "@langwatch/observability";
import type { StoredObjectStorageRuntimeAdapter } from "@langwatch/stored-object-server";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import {
  TraceEdgeSpoolService,
  TraceIngressPayload,
  TraceSpoolService,
} from "@langwatch/trace-server";

import { ApiTraceSpoolStorageAdapter } from "../platform/infrastructure/api-trace-spool.adapter.ts";

export type ApiTraceSpoolOptions = Readonly<{
  /** The byte storage the object store composed, or none. */
  storage:
    | Readonly<{ runtime: StoredObjectStorageRuntimeAdapter; aws: AwsClientProcessRuntime }>
    | undefined;
  /** Whether Azure Blob may host the spool on this deployment. */
  azureRetentionConfirmed: boolean;
  /** The per-project switch, read on every over-threshold span. */
  featureFlags: FeatureFlagApi;
  logger: Logger;
}>;

/**
 * Composes the spool, or nothing where this process addressed no bytes —
 * which is the pre-ADR-022 behaviour, and the truncation that comes with it.
 */
export function composeApiTraceSpool(
  options: ApiTraceSpoolOptions,
): TraceIngressPayload | undefined {
  const { storage } = options;
  if (!storage) {
    options.logger.warn(
      { capability: "payload-spool" },
      "no object store, so an over-threshold span is queued whole and its oversized attribute values are truncated",
    );
    return undefined;
  }

  return ApiFlagGatedTraceEdgeSpool.create({
    featureFlags: options.featureFlags,
    logger: options.logger,
    spool: TraceEdgeSpoolService.create({
      spool: TraceSpoolService.create({
        storage: ApiTraceSpoolStorageAdapter.create({
          runtime: storage.runtime,
          aws: storage.aws,
          azureRetentionConfirmed: options.azureRetentionConfirmed,
        }),
        logger: options.logger,
      }),
      logger: options.logger,
    }),
  });
}

/**
 * The per-project switch. FAIL-OPEN: a flag store that cannot answer leaves
 * the span on the inline route rather than refusing it, and says so.
 */
class ApiFlagGatedTraceEdgeSpool extends TraceIngressPayload {
  static create(options: {
    featureFlags: FeatureFlagApi;
    spool: TraceIngressPayload;
    logger: Logger;
  }): ApiFlagGatedTraceEdgeSpool {
    return new ApiFlagGatedTraceEdgeSpool(options);
  }

  private constructor(
    private readonly options: {
      featureFlags: FeatureFlagApi;
      spool: TraceIngressPayload;
      logger: Logger;
    },
  ) {
    super();
  }

  async prepare(data: RecordSpanCommandData): Promise<RecordSpanCommandData> {
    const projectId = data.tenantId;
    let enabled: boolean;
    try {
      enabled = await this.options.featureFlags.isEnabled("release_trace_blob_offload", {
        kind: "project",
        projectId,
      });
    } catch (error) {
      this.options.logger.warn(
        { error, projectId, traceId: data.span.traceId, spanId: data.span.spanId },
        "oversize protection skipped: the offload switch could not be read, so the queue carries the full payload",
      );
      return data;
    }

    return enabled ? await this.options.spool.prepare(data) : data;
  }
}

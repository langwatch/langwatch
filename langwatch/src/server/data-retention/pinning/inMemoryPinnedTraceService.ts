import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { PinnedTraceSummary } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import {
  type HasActiveShareForTrace,
  type PinnedTraceReader,
  type PinTraceCommands,
  PinnedTraceService,
} from "./pinnedTrace.service";

/**
 * In-memory `PinnedTraceService` for the null-backed test app and unit tests —
 * the analogue of the `*Memory` repositories used elsewhere in the composition
 * root. The command handlers replicate the fold projection's pin state machine
 * (manual overrides share; a share unpin never clears a manual pin) so
 * behaviour-level tests exercise the same semantics as the ClickHouse path
 * without a running event store.
 */
export function createInMemoryPinnedTraceService(
  hasActiveShareForTrace?: HasActiveShareForTrace,
): PinnedTraceService {
  // tenantId -> traceId -> pin
  const store = new Map<string, Map<string, PinnedTraceSummary>>();

  const tenant = (tenantId: string) => {
    let byTrace = store.get(tenantId);
    if (!byTrace) {
      byTrace = new Map();
      store.set(tenantId, byTrace);
    }
    return byTrace;
  };

  const commands: PinTraceCommands = {
    pinTrace: async ({
      tenantId,
      traceId,
      source,
      reason,
      pinnedByUserId,
      occurredAt,
    }) => {
      const byTrace = tenant(tenantId);
      // A share auto-pin only takes effect on an unpinned trace.
      if (source === "share" && byTrace.has(traceId)) return;
      byTrace.set(traceId, {
        traceId,
        source,
        reason,
        pinnedByUserId,
        pinnedAt: occurredAt,
      });
    },
    unpinTrace: async ({ tenantId, traceId, source }) => {
      const byTrace = tenant(tenantId);
      const existing = byTrace.get(traceId);
      // A share-sourced unpin only clears a still-share-sourced pin.
      if (source === "share" && existing?.source !== "share") return;
      byTrace.delete(traceId);
    },
  };

  const reader: PinnedTraceReader = {
    findByTraceId: async (tenantId, traceId) => {
      const pin = store.get(tenantId)?.get(traceId);
      if (!pin) return null;
      // The service reads only the pin fields off the summary.
      return {
        pinnedSource: pin.source,
        pinnedReason: pin.reason,
        pinnedByUserId: pin.pinnedByUserId,
        pinnedAt: pin.pinnedAt,
      } as unknown as TraceSummaryData;
    },
    findPinnedTraces: async (tenantId) => [
      ...(store.get(tenantId)?.values() ?? []),
    ],
  };

  return new PinnedTraceService(commands, reader, hasActiveShareForTrace);
}

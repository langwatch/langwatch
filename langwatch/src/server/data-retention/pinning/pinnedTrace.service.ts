import type {
  PinnedTraceSummary,
  TraceSummaryRepository,
} from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { TracePinSource } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";

interface PinTraceParams {
  projectId: string;
  traceId: string;
  userId?: string | null;
  reason?: string | null;
}

interface UnpinTraceParams {
  projectId: string;
  traceId: string;
}

/**
 * A pinned trace as returned to callers. Sourced from the `trace_summaries`
 * projection (migration 00037) rather than the legacy `PinnedTrace` Postgres
 * table. `source` drives the UI's manual-vs-share affordance; `userId` mirrors
 * the old row's attribution field.
 */
export interface PinnedTraceView {
  projectId: string;
  traceId: string;
  source: TracePinSource;
  reason: string | null;
  userId: string | null;
  pinnedAt: number | null;
}

/**
 * Thrown when an unpin is attempted while the trace still has an active share.
 * Pins are UI annotations only and do not exempt ClickHouse rows from retention,
 * but a live share owns the share-created pin annotation until the share is
 * removed.
 *
 * Caught in the tRPC router and translated to CONFLICT.
 */
export class PinnedToActiveShareError extends Error {
  readonly name = "PinnedToActiveShareError" as const;
}

/** Predicate the pinning service uses to learn whether a trace's share is
 *  still live, without importing the share service (which itself depends on
 *  the pinning service). Wired in `presets.ts`. */
export type HasActiveShareForTrace = (params: {
  projectId: string;
  traceId: string;
}) => Promise<boolean>;

/** Command dispatchers for the event-sourced pin/unpin path. `tenantId` is the
 *  projectId by convention; `occurredAt` stamps the event and disambiguates
 *  successive toggle actions (see PinTraceCommand). */
export interface PinTraceCommands {
  pinTrace: (input: {
    tenantId: string;
    traceId: string;
    source: TracePinSource;
    reason: string | null;
    pinnedByUserId: string | null;
    occurredAt: number;
  }) => Promise<unknown>;
  unpinTrace: (input: {
    tenantId: string;
    traceId: string;
    source: TracePinSource;
    occurredAt: number;
  }) => Promise<unknown>;
}

/** The subset of the trace-summary repository the pinning reads need. */
export type PinnedTraceReader = Pick<
  TraceSummaryRepository,
  "findByTraceId" | "findPinnedTraces"
>;

/**
 * Pins live on the trace summary and are mutated exclusively through the
 * `pinTrace` / `unpinTrace` commands. The pin state machine (manual overrides
 * share; a share unpin never clears a manual pin) is enforced in the fold
 * projection, so this service only decides *which* command to dispatch and
 * guards a manual unpin against an active share. Reads project the pin fields
 * off `trace_summaries`.
 *
 * Because the write path is event-sourced, reads are eventually consistent: a
 * fresh pin/unpin is visible once its command has been projected. Callers that
 * need an immediate reflection use the optimistic view returned by `pin`.
 */
export class PinnedTraceService {
  constructor(
    private readonly commands: PinTraceCommands,
    private readonly reader: PinnedTraceReader,
    private readonly hasActiveShareForTrace: HasActiveShareForTrace = async () =>
      false,
  ) {}

  async pin(params: PinTraceParams): Promise<PinnedTraceView> {
    const occurredAt = Date.now();
    const reason = params.reason ?? null;
    const userId = params.userId ?? null;
    await this.commands.pinTrace({
      tenantId: params.projectId,
      traceId: params.traceId,
      source: "manual",
      reason,
      pinnedByUserId: userId,
      occurredAt,
    });
    return {
      projectId: params.projectId,
      traceId: params.traceId,
      source: "manual",
      reason,
      userId,
      pinnedAt: occurredAt,
    };
  }

  async unpin(params: UnpinTraceParams): Promise<void> {
    // While a share is live, the share-created pin annotation belongs to that
    // share lifecycle. Pins are not retention exemptions: CH rows still age out
    // under the resolved policy. The guard checks for an active share
    // regardless of the pin's source, so a share->manual promotion keeps the
    // annotation until the share is removed. After unshare, `autoUnpin`
    // dispatches a share-sourced unpin which the fold leaves as a no-op when a
    // manual pin has taken over, so the user's manual pin survives cleanly.
    const stillShared = await this.hasActiveShareForTrace(params);
    if (stillShared) {
      throw new PinnedToActiveShareError(
        "This trace is currently shared. Disable the share before unpinning.",
      );
    }
    await this.commands.unpinTrace({
      tenantId: params.projectId,
      traceId: params.traceId,
      source: "manual",
      occurredAt: Date.now(),
    });
  }

  async autoPin({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<PinnedTraceView> {
    const occurredAt = Date.now();
    await this.commands.pinTrace({
      tenantId: projectId,
      traceId,
      source: "share",
      reason: null,
      pinnedByUserId: null,
      occurredAt,
    });
    return {
      projectId,
      traceId,
      source: "share",
      reason: null,
      userId: null,
      pinnedAt: occurredAt,
    };
  }

  async autoUnpin({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<void> {
    // Dispatch a share-sourced unpin unconditionally — the fold projection only
    // clears the pin when it is still share-sourced, so a manual pin that has
    // taken over survives. No read-then-decide, so there is no stale-read race.
    await this.commands.unpinTrace({
      tenantId: projectId,
      traceId,
      source: "share",
      occurredAt: Date.now(),
    });
  }

  async isPinned({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<boolean> {
    return (await this.getPin({ projectId, traceId })) != null;
  }

  async getPin({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<PinnedTraceView | null> {
    const summary = await this.reader.findByTraceId(projectId, traceId);
    if (!summary || summary.pinnedSource == null) return null;
    return {
      projectId,
      traceId,
      source: summary.pinnedSource,
      reason: summary.pinnedReason ?? null,
      userId: summary.pinnedByUserId ?? null,
      pinnedAt: summary.pinnedAt ?? null,
    };
  }

  async listByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<PinnedTraceView[]> {
    const pinned = await this.reader.findPinnedTraces(projectId);
    return pinned.map((pin) => this.toView(projectId, pin));
  }

  async getPinnedTraceIds({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[]> {
    const pinned = await this.reader.findPinnedTraces(projectId);
    return pinned.map((pin) => pin.traceId);
  }

  private toView(
    projectId: string,
    pin: PinnedTraceSummary,
  ): PinnedTraceView {
    return {
      projectId,
      traceId: pin.traceId,
      source: pin.source,
      reason: pin.reason,
      userId: pin.pinnedByUserId,
      pinnedAt: pin.pinnedAt,
    };
  }
}

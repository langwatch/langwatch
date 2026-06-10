import { type PinnedTrace, PinSource } from "@prisma/client";
import type { PinnedTraceRepository } from "./pinnedTrace.repository";

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

export class PinnedTraceService {
  constructor(
    private readonly repository: PinnedTraceRepository,
    private readonly hasActiveShareForTrace: HasActiveShareForTrace = async () => false,
  ) {}

  async pin(params: PinTraceParams): Promise<PinnedTrace> {
    return this.repository.create({
      ...params,
      source: PinSource.manual,
    });
  }

  async unpin(params: UnpinTraceParams): Promise<void> {
    // While a share is live, the share-created pin annotation belongs to that
    // share lifecycle. Pins are not retention exemptions: CH rows still age out
    // under the resolved policy. The guard checks for an active share regardless
    // of `pin.source`, so a share->manual promotion (autoPin then explicit pin)
    // keeps the annotation until the share is removed. After unshare,
    // `autoUnpin` preserves the row when source=manual so the user's manual pin
    // survives cleanly.
    const stillShared = await this.hasActiveShareForTrace(params);
    if (stillShared) {
      throw new PinnedToActiveShareError(
        "This trace is currently shared. Disable the share before unpinning.",
      );
    }
    await this.repository.delete(params);
  }

  async autoPin({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<PinnedTrace> {
    return this.repository.create({
      projectId,
      traceId,
      source: PinSource.share,
    });
  }

  async autoUnpin({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<void> {
    const hasManual = await this.repository.hasManualPin({
      projectId,
      traceId,
    });
    if (hasManual) return;

    await this.repository.delete({ projectId, traceId });
  }

  async isPinned({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<boolean> {
    const pin = await this.repository.findByProjectAndTrace({
      projectId,
      traceId,
    });
    return pin != null;
  }

  async getPin({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<PinnedTrace | null> {
    return this.repository.findByProjectAndTrace({ projectId, traceId });
  }

  async listByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<PinnedTrace[]> {
    return this.repository.findAllByProject({ projectId });
  }

  async getPinnedTraceIds({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[]> {
    return this.repository.findAllTraceIds({ projectId });
  }
}

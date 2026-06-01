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

export class PinnedTraceService {
  constructor(private readonly repository: PinnedTraceRepository) {}

  async pin(params: PinTraceParams): Promise<PinnedTrace> {
    return this.repository.create({
      ...params,
      source: PinSource.manual,
    });
  }

  async unpin(params: UnpinTraceParams): Promise<void> {
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

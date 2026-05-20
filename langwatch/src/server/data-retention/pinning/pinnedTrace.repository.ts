import type { PrismaClient, PinnedTrace } from "@prisma/client";

export type PinSource = "manual" | "share";

interface CreatePinnedTraceParams {
  projectId: string;
  traceId: string;
  userId?: string | null;
  reason?: string | null;
  source: PinSource;
}

export class PinnedTraceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByProjectAndTrace({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<PinnedTrace | null> {
    return this.prisma.pinnedTrace.findUnique({
      where: { projectId_traceId: { projectId, traceId } },
    });
  }

  async findAllByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<PinnedTrace[]> {
    return this.prisma.pinnedTrace.findMany({
      where: { projectId },
    });
  }

  async findAllTraceIds({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[]> {
    const pins = await this.prisma.pinnedTrace.findMany({
      where: { projectId },
      select: { traceId: true },
    });
    return pins.map((p) => p.traceId);
  }

  async create(params: CreatePinnedTraceParams): Promise<PinnedTrace> {
    return this.prisma.pinnedTrace.upsert({
      where: {
        projectId_traceId: {
          projectId: params.projectId,
          traceId: params.traceId,
        },
      },
      update: {},
      create: {
        projectId: params.projectId,
        traceId: params.traceId,
        userId: params.userId ?? null,
        reason: params.source === "share"
          ? "__auto_share"
          : (params.reason ?? null),
      },
    });
  }

  async delete({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<void> {
    await this.prisma.pinnedTrace.deleteMany({
      where: { projectId, traceId },
    });
  }

  async isAutoSharePin({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<boolean> {
    const pin = await this.findByProjectAndTrace({ projectId, traceId });
    return pin?.reason === "__auto_share";
  }

  async hasManualPin({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<boolean> {
    const pin = await this.findByProjectAndTrace({ projectId, traceId });
    return pin != null && pin.reason !== "__auto_share";
  }
}

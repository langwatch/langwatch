import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import type {
  FanOutBatch,
  FanOutBatchStatus,
  FanOutVariant,
  FanOutVariantStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { KSUID_RESOURCES } from "~/utils/constants";

const tracer = getLangWatchTracer("langwatch.scenarios.fan-out.repository");
const logger = createLogger("langwatch:scenarios:fan-out:repository");

export type CreateFanOutBatchInput = Omit<
  Prisma.FanOutBatchUncheckedCreateInput,
  "status" | "createdAt" | "updatedAt"
>;

export type CreateFanOutVariantInput = Omit<
  Prisma.FanOutVariantUncheckedCreateInput,
  "id" | "status" | "createdAt" | "updatedAt"
>;

export class FanOutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createBatch(input: CreateFanOutBatchInput): Promise<FanOutBatch> {
    return tracer.withActiveSpan(
      "FanOutRepository.createBatch",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "INSERT",
          "db.table": "FanOutBatch",
          "tenant.id": input.projectId,
        },
      },
      async (span) => {
        const result = await this.prisma.fanOutBatch.create({ data: input });
        span.setAttribute("fan_out_batch.id", result.id);
        return result;
      },
    );
  }

  async createVariants(
    inputs: CreateFanOutVariantInput[],
  ): Promise<FanOutVariant[]> {
    return tracer.withActiveSpan(
      "FanOutRepository.createVariants",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "INSERT",
          "db.table": "FanOutVariant",
          "result.count": inputs.length,
        },
      },
      async () => {
        return Promise.all(
          inputs.map((input) =>
            this.prisma.fanOutVariant.create({
              data: {
                id: generate(KSUID_RESOURCES.FAN_OUT_VARIANT).toString(),
                ...input,
              },
            }),
          ),
        );
      },
    );
  }

  async findBatchById(input: {
    id: string;
    projectId: string;
  }): Promise<(FanOutBatch & { variants: FanOutVariant[] }) | null> {
    return tracer.withActiveSpan(
      "FanOutRepository.findBatchById",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "SELECT",
          "db.table": "FanOutBatch",
          "tenant.id": input.projectId,
          "fan_out_batch.id": input.id,
        },
      },
      async (span) => {
        const result = await this.prisma.fanOutBatch.findFirst({
          where: { id: input.id, projectId: input.projectId },
          include: { variants: true },
        });
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  async updateBatchStatus(input: {
    id: string;
    projectId: string;
    status: FanOutBatchStatus;
    batchRunId?: string;
    promotedSuiteId?: string;
  }): Promise<FanOutBatch> {
    return tracer.withActiveSpan(
      "FanOutRepository.updateBatchStatus",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "UPDATE",
          "db.table": "FanOutBatch",
          "tenant.id": input.projectId,
          "fan_out_batch.id": input.id,
        },
      },
      async () => {
        return this.prisma.fanOutBatch.update({
          where: { id: input.id, projectId: input.projectId },
          data: {
            status: input.status,
            ...(input.batchRunId ? { batchRunId: input.batchRunId } : {}),
            ...(input.promotedSuiteId
              ? { promotedSuiteId: input.promotedSuiteId }
              : {}),
          },
        });
      },
    );
  }

  async findVariantsByIds(input: {
    ids: string[];
    batchId: string;
  }): Promise<FanOutVariant[]> {
    return tracer.withActiveSpan(
      "FanOutRepository.findVariantsByIds",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "SELECT",
          "db.table": "FanOutVariant",
        },
      },
      async () => {
        return this.prisma.fanOutVariant.findMany({
          where: { id: { in: input.ids }, batchId: input.batchId },
        });
      },
    );
  }

  async updateVariantStatus(input: {
    id: string;
    status: FanOutVariantStatus;
    decidedById: string | null;
  }): Promise<FanOutVariant> {
    return tracer.withActiveSpan(
      "FanOutRepository.updateVariantStatus",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "UPDATE",
          "db.table": "FanOutVariant",
          "fan_out_variant.id": input.id,
        },
      },
      async () => {
        return this.prisma.fanOutVariant.update({
          where: { id: input.id },
          data: {
            status: input.status,
            decidedById: input.decidedById,
            decidedAt: new Date(),
          },
        });
      },
    );
  }

  async setVariantScenarioRunId(input: {
    id: string;
    scenarioRunId: string;
  }): Promise<void> {
    await this.prisma.fanOutVariant.update({
      where: { id: input.id },
      data: { scenarioRunId: input.scenarioRunId },
    });
  }
}

import { generate } from "@langwatch/ksuid";
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
          },
        });
      },
    );
  }

  /**
   * Applies a whole review decision set atomically: every variant flips status
   * together, and the scenarios behind rejected variants are archived in the
   * same transaction so a reject can never leave its scenario in the library.
   *
   * FanOutVariant has no projectId of its own (RELATIONAL_PARENT_SCOPED), so
   * every read and write here is scoped through the parent batch, which does.
   * Returns null when any requested id is not part of that batch, so the caller
   * can reject the whole set rather than silently applying part of it.
   */
  async applyDecisions(input: {
    batchId: string;
    projectId: string;
    decisions: Array<{ variantId: string; status: FanOutVariantStatus }>;
    decidedById: string | null;
  }): Promise<FanOutVariant[] | null> {
    return tracer.withActiveSpan(
      "FanOutRepository.applyDecisions",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "UPDATE",
          "db.table": "FanOutVariant",
          "tenant.id": input.projectId,
          "fan_out_batch.id": input.batchId,
          "result.count": input.decisions.length,
        },
      },
      async (span) => {
        return this.prisma.$transaction(async (tx) => {
          const ids = input.decisions.map((decision) => decision.variantId);
          const found = await tx.fanOutVariant.findMany({
            where: {
              id: { in: ids },
              batchId: input.batchId,
              batch: { projectId: input.projectId },
            },
            select: { id: true },
          });

          if (found.length !== new Set(ids).size) {
            span.setAttribute("result.found", false);
            return null;
          }

          const decidedAt = new Date();
          const updated: FanOutVariant[] = [];
          const rejectedScenarioIds: string[] = [];

          for (const { variantId, status } of input.decisions) {
            const variant = await tx.fanOutVariant.update({
              where: { id: variantId, batchId: input.batchId },
              data: {
                status,
                decidedById: input.decidedById,
                decidedAt,
              },
            });
            updated.push(variant);
            if (status === "REJECTED") {
              rejectedScenarioIds.push(variant.scenarioId);
            }
          }

          if (rejectedScenarioIds.length > 0) {
            await tx.scenario.updateMany({
              where: {
                id: { in: rejectedScenarioIds },
                projectId: input.projectId,
                archivedAt: null,
              },
              data: { archivedAt: decidedAt },
            });
          }

          span.setAttribute("result.found", true);
          return updated;
        });
      },
    );
  }

  /**
   * Records the run id a variant was dispatched under, so the blast-radius
   * report can join the variant to its ClickHouse verdict.
   */
  async setVariantScenarioRunId(input: {
    id: string;
    projectId: string;
    scenarioRunId: string;
  }): Promise<void> {
    await this.prisma.fanOutVariant.updateMany({
      where: { id: input.id, batch: { projectId: input.projectId } },
      data: { scenarioRunId: input.scenarioRunId },
    });
  }
}

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

type FanOutTransaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

/**
 * Whether every requested id is a distinct variant of this batch.
 *
 * A repeated id would pass a set-size membership check and then be updated
 * twice, with the last decision winning silently. Two conflicting decisions
 * for one variant is a caller bug, not something to resolve by ordering.
 */
async function allVariantsInBatch({
  tx,
  batchId,
  projectId,
  ids,
}: {
  tx: FanOutTransaction;
  batchId: string;
  projectId: string;
  ids: string[];
}): Promise<boolean> {
  if (new Set(ids).size !== ids.length) return false;

  const found = await tx.fanOutVariant.findMany({
    where: { id: { in: ids }, batchId, batch: { projectId } },
    select: { id: true },
  });
  return found.length === ids.length;
}

/** Archives the scenarios behind the variants that were just rejected. */
async function archiveRejected({
  tx,
  projectId,
  updated,
  decidedAt,
}: {
  tx: FanOutTransaction;
  projectId: string;
  updated: FanOutVariant[];
  decidedAt: Date;
}): Promise<void> {
  const scenarioIds = updated
    .filter((variant) => variant.status === "REJECTED")
    .map((variant) => variant.scenarioId);
  if (scenarioIds.length === 0) return;

  await tx.scenario.updateMany({
    where: { id: { in: scenarioIds }, projectId, archivedAt: null },
    data: { archivedAt: decidedAt },
  });
}

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

  /**
   * Persists the generated scenarios and the variant rows that review them, in
   * one transaction.
   *
   * They are written together because a scenario without its variant is an
   * orphan: it sits in the library carrying fan-out labels with no review
   * record and no way to reach one, which is exactly what the review gate
   * exists to prevent. The LLM call stays outside, so no model latency is ever
   * held inside a database transaction.
   */
  async createScenariosWithVariants(input: {
    projectId: string;
    createdById: string | null;
    batchId: string;
    entries: Array<{
      name: string;
      situation: string;
      criteria: string[];
      labels: string[];
      lens: string;
      rationale: string;
    }>;
  }): Promise<FanOutVariant[]> {
    return tracer.withActiveSpan(
      "FanOutRepository.createScenariosWithVariants",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "INSERT",
          "db.table": "FanOutVariant",
          "tenant.id": input.projectId,
          "fan_out_batch.id": input.batchId,
          "result.count": input.entries.length,
        },
      },
      async () => {
        return this.prisma.$transaction(async (tx) => {
          const variants: FanOutVariant[] = [];
          for (const entry of input.entries) {
            const scenario = await tx.scenario.create({
              data: {
                projectId: input.projectId,
                name: entry.name,
                situation: entry.situation,
                criteria: entry.criteria,
                labels: entry.labels,
                lastUpdatedById: input.createdById,
              },
            });
            variants.push(
              await tx.fanOutVariant.create({
                data: {
                  id: generate(KSUID_RESOURCES.FAN_OUT_VARIANT).toString(),
                  batchId: input.batchId,
                  scenarioId: scenario.id,
                  lens: entry.lens,
                  rationale: entry.rationale,
                },
              }),
            );
          }
          return variants;
        });
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
    seedScenarioRunId?: string;
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
            ...(input.seedScenarioRunId
              ? { seedScenarioRunId: input.seedScenarioRunId }
              : {}),
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
        const result = await this.prisma.$transaction(async (tx) => {
          const identified = await allVariantsInBatch({
            tx,
            batchId: input.batchId,
            projectId: input.projectId,
            ids: input.decisions.map((decision) => decision.variantId),
          });
          if (!identified) return null;

          const decidedAt = new Date();
          const updated: FanOutVariant[] = [];
          for (const { variantId, status } of input.decisions) {
            updated.push(
              await tx.fanOutVariant.update({
                where: { id: variantId, batchId: input.batchId },
                data: { status, decidedById: input.decidedById, decidedAt },
              }),
            );
          }

          await archiveRejected({
            tx,
            projectId: input.projectId,
            updated,
            decidedAt,
          });

          return updated;
        });

        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  /**
   * Records the run id a variant was dispatched under, so the blast-radius
   * report can join the variant to its ClickHouse verdict.
   *
   * `null` takes the id back, for a run that was reserved an id and then
   * failed to reach the queue.
   */
  async setVariantScenarioRunId(input: {
    id: string;
    projectId: string;
    scenarioRunId: string | null;
  }): Promise<void> {
    await this.prisma.fanOutVariant.updateMany({
      where: { id: input.id, batch: { projectId: input.projectId } },
      data: { scenarioRunId: input.scenarioRunId },
    });
  }
}

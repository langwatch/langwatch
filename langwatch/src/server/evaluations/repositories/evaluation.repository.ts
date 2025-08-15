import { prisma } from "~/server/db";
import { type Monitor, type CostType, type CostReferenceType } from "@prisma/client";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:evaluations:repository");

export interface EvaluationRepository {
  findStoredEvaluator(projectId: string, evaluatorSlug: string): Promise<Monitor | null>;
  createCost(data: {
    id: string;
    projectId: string;
    costType: CostType;
    costName: string;
    referenceType: CostReferenceType;
    referenceId: string;
    amount: number;
    currency: string;
    extraInfo: Record<string, unknown> | null;
  }): Promise<void>;
}

export class PrismaEvaluationRepository implements EvaluationRepository {
  async findStoredEvaluator(projectId: string, evaluatorSlug: string): Promise<Monitor | null> {
    try {
      return await prisma.monitor.findUnique({
        where: {
          projectId_slug: {
            projectId,
            slug: evaluatorSlug,
          },
        },
      });
    } catch (error) {
      logger.error({ error, projectId, evaluatorSlug }, "Failed to find stored evaluator");
      throw error;
    }
  }

  async createCost(data: {
    id: string;
    projectId: string;
    costType: CostType;
    costName: string;
    referenceType: CostReferenceType;
    referenceId: string;
    amount: number;
    currency: string;
    extraInfo: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      await prisma.cost.create({
        data,
      });
    } catch (error) {
      logger.error({ error, projectId: data.projectId }, "Failed to create cost record");
      throw error;
    }
  }
}

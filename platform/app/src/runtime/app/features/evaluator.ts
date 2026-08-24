import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import {
  PostgresEvaluatorAdapter,
  type EvaluatorAuditLogPort,
} from "@langwatch/evaluator-server";
import type { PrismaClient } from "~/generated/prisma/client";

class AppEvaluatorAuditLogPort implements EvaluatorAuditLogPort {
  static create(database: PrismaClient): AppEvaluatorAuditLogPort {
    return new AppEvaluatorAuditLogPort(database);
  }

  private constructor(private readonly database: PrismaClient) {}

  async history(input: {
    evaluatorId: string;
    projectId: string;
    limit: number;
  }) {
    return this.database.auditLog.findMany({
      where: {
        projectId: input.projectId,
        action: { startsWith: "evaluators." },
        OR: [
          { args: { path: ["id"], equals: input.evaluatorId } },
          { args: { path: ["evaluatorId"], equals: input.evaluatorId } },
          { args: { path: ["newEvaluatorId"], equals: input.evaluatorId } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
  }

  users(input: { userIds: string[] }) {
    return this.database.user.findMany({
      where: { id: { in: input.userIds } },
      select: { id: true, name: true, email: true },
    });
  }
}

/**
 * Process-owned composition for Evaluator. Cross-feature behavior comes from
 * the canonical Workflow service, never a Workflow repository or a duplicate
 * caller-side port.
 */
export class EvaluatorFeature {
  static create(options: {
    prisma: PrismaClient;
    workflows: WorkflowService;
    auditLog?: EvaluatorAuditLogPort;
    fallbackModels?: { defaultModel: string; embeddingsModel: string };
  }): EvaluatorService {
    return PostgresEvaluatorAdapter.create({
      database: options.prisma,
      workflows: options.workflows,
      auditLog: options.auditLog ?? AppEvaluatorAuditLogPort.create(options.prisma),
      fallbackModels: options.fallbackModels,
    });
  }
}

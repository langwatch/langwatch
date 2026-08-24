import type { EvaluatorService as EvaluatorServiceContract } from "@langwatch/evaluator-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { EvaluatorAuditLogPort } from "../ports/evaluator.port";
import type { EvaluatorDatabase } from "../repositories/evaluator.repository";
import { PrismaEvaluatorRepository } from "../repositories/prisma/prisma.evaluator.repository";
import { EvaluatorService } from "../services/evaluator.service";

export type PostgresEvaluatorAdapterOptions = {
  database: EvaluatorDatabase;
  workflows: Pick<WorkflowService, "assertInProject" | "getFields">;
  auditLog?: EvaluatorAuditLogPort;
  fallbackModels?: { defaultModel: string; embeddingsModel: string };
};

/** Composes the evaluator service once from the process Postgres connection. */
export class PostgresEvaluatorAdapter {
  static create(options: PostgresEvaluatorAdapterOptions): EvaluatorServiceContract {
    return EvaluatorService.create({
      repository: PrismaEvaluatorRepository.create(options.database),
      workflows: options.workflows,
      auditLog: options.auditLog,
      fallbackModels: options.fallbackModels,
    });
  }
}

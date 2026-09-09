/**
 * The Postgres-backed evaluator service, as the process still asks for it.
 *
 * This exists because `EvaluatorService` is still a contract abstract class
 * several other features take (gateway, monitor, experiment, evaluation,
 * workflow), so the process composes ONE and hands it around. It goes when that
 * does; the repository behind it is already the annotation shape.
 */
import type { EvaluatorService as EvaluatorServiceContract } from "@langwatch/evaluator-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { WorkflowService } from "@langwatch/workflow-contract";

import type { EvaluatorAuditLogPort, EvaluatorCodeExecutionPort } from "../ports/evaluator.port.ts";
import { PrismaEvaluatorRepository } from "../repositories/prisma/prisma.evaluator.repository.ts";
import { EvaluatorService } from "../services/evaluator.service.ts";

export type PostgresEvaluatorAdapterOptions = {
  prisma: PrismaClient;
  workflows: WorkflowService;
  auditLog?: EvaluatorAuditLogPort;
  fallbackModels?: { defaultModel: string; embeddingsModel: string };
  codeExecution: EvaluatorCodeExecutionPort;
  generateId: () => string;
};

export class PostgresEvaluatorAdapter {
  static create(options: PostgresEvaluatorAdapterOptions): EvaluatorServiceContract {
    return EvaluatorService.create({
      repository: PrismaEvaluatorRepository.create({ prisma: options.prisma }),
      workflows: options.workflows,
      auditLog: options.auditLog,
      fallbackModels: options.fallbackModels,
      codeExecution: options.codeExecution,
      generateId: options.generateId,
    });
  }
}

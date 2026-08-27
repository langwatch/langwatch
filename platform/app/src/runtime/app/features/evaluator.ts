import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import {
  EvaluatorAuditLogPort,
  EvaluatorCodeExecutionPort,
  PostgresEvaluatorAdapter,
} from "@langwatch/evaluator-server";
import type { WorkflowNlpRuntimePort } from "@langwatch/workflow-server";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import type { PrismaClient } from "~/generated/prisma/client";
import { DEFAULT_EMBEDDINGS_MODEL, DEFAULT_MODEL } from "~/utils/constants";
import { nanoid } from "nanoid";

class AppEvaluatorCodeExecutionPort extends EvaluatorCodeExecutionPort {
  static create(nlpRuntime: WorkflowNlpRuntimePort): AppEvaluatorCodeExecutionPort {
    return new AppEvaluatorCodeExecutionPort(nlpRuntime);
  }

  private constructor(private readonly nlpRuntime: WorkflowNlpRuntimePort) {
    super();
  }

  async execute(input: {
    projectId: string;
    event: StudioClientEvent;
    causalityDepth: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }) {
    const response = await this.nlpRuntime.dispatch({
      projectId: input.projectId,
      body: input.event,
      origin: "evaluation",
      causalityDepth: input.causalityDepth,
      parentTrace: input.parentTrace,
    });

    return {
      ok: response.ok,
      statusText: response.statusText,
      body: await response.json(),
    };
  }
}

class AppEvaluatorAuditLogPort extends EvaluatorAuditLogPort {
  static create(database: PrismaClient): AppEvaluatorAuditLogPort {
    return new AppEvaluatorAuditLogPort(database);
  }

  private constructor(private readonly database: PrismaClient) {
    super();
  }

  async history(input: { evaluatorId: string; projectId: string; limit: number }) {
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
    nlpRuntime: WorkflowNlpRuntimePort;
    auditLog?: EvaluatorAuditLogPort;
    fallbackModels?: { defaultModel: string; embeddingsModel: string };
  }): EvaluatorService {
    return PostgresEvaluatorAdapter.create({
      database: options.prisma,
      workflows: options.workflows,
      auditLog: options.auditLog ?? AppEvaluatorAuditLogPort.create(options.prisma),
      fallbackModels: options.fallbackModels ?? {
        defaultModel: DEFAULT_MODEL,
        embeddingsModel: DEFAULT_EMBEDDINGS_MODEL,
      },
      codeExecution: AppEvaluatorCodeExecutionPort.create(options.nlpRuntime),
      generateId: nanoid,
    });
  }
}

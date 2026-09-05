/**
 * The evaluators a project defines, composed as their own feature. `evaluators.*` reads
 * and writes the evaluator rows, and publishes the `ctx.app.evaluatorApp` slice the
 * packaged evaluator REST family reads.
 */
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import {
  EvaluatorApp,
  NlpEvaluatorCodeExecutionAdapter,
  PostgresEvaluatorAdapter,
  PrismaEvaluatorAuditLogAdapter,
  type EvaluatorTrpcPorts,
} from "@langwatch/evaluator-server";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { WorkflowApp, WorkflowNlpRuntimePort } from "@langwatch/workflow-server";
import type { WorkflowService } from "@langwatch/workflow-contract";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { createEvaluatorTrpcRouter } from "./evaluator-trpc.mount";

/**
 * The ONE evaluator service on this process.
 */
export function composeEvaluatorService(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: Readonly<{
    /** The workflow service an evaluator's published graph is read through. */
    workflows: WorkflowService;
    /** Where a code evaluator executes. */
    nlpRuntime: WorkflowNlpRuntimePort;
  }>;
}): EvaluatorService {
  return PostgresEvaluatorAdapter.create({
    database: options.infrastructure.prisma,
    workflows: options.peers.workflows,
    auditLog: PrismaEvaluatorAuditLogAdapter.create(options.infrastructure.prisma),
    codeExecution: NlpEvaluatorCodeExecutionAdapter.create(options.peers.nlpRuntime),
    generateId: () => nanoid(),
  });
}

/** The other features' services the evaluator surface reaches, named one by one. */
export type EvaluatorPeers = Readonly<{
  /**
   * The evaluator service the execution half already composed. Taken rather
   * than built: the workflow application publishes evaluators through this one.
   */
  evaluators: EvaluatorService;
  /**
   * The workflow application a WORKFLOW evaluator's graph is replicated through. The
   * studio DSL, its dataset references and its version history are Workflow's, and
   * neither the evaluator nor the monitor package reaches into them.
   */
  workflows: WorkflowApp;
  /**
   * The model gateway, where the deployment composed one. It resolves a project's default
   * and embeddings models when an evaluator is created without naming them.
   */
  modelProviders?: ModelProviderService;
}>;

/** Everything the evaluator surface is composed from. */
export type EvaluatorFeatureCollaborators = EvaluatorPeers &
  Readonly<{ prisma: ApiTrpcInfrastructure["prisma"] }>;

/** The namespace, its `ctx.app` slice, and the ports the monitor copy takes. */
export type ComposedEvaluatorFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createEvaluatorTrpcRouter>;
  /** For `ctx.app.evaluatorApp`. */
  app: EvaluatorApp;
  /** The replication half of these ports, taken by the monitor feature. */
  ports: EvaluatorTrpcPorts;
}>;

/** Composes the evaluator surface over this process's own graph. */
export function composeEvaluatorFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: EvaluatorPeers;
}): ComposedEvaluatorFeature {
  const collaborators: EvaluatorFeatureCollaborators = {
    ...options.peers,
    prisma: options.infrastructure.prisma,
  };
  const ports = composeEvaluatorPorts(collaborators);

  return {
    router: (mount) => createEvaluatorTrpcRouter({ ...mount, ports }),
    app: EvaluatorApp.create({
      evaluators: options.peers.evaluators,
      ...(options.peers.modelProviders ? { modelProviders: options.peers.modelProviders } : {}),
    } as Parameters<typeof EvaluatorApp.create>[0]),
    ports,
  };
}

/**
 * The evaluator surface on a process that composed no graph to run it over.
 */
export function refusingEvaluatorFeature(): ComposedEvaluatorFeature {
  const refuse = (): never => {
    throw new ApiEvaluatorUnavailableError();
  };
  const refuseEvery = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;
  const ports = refuseEvery<EvaluatorTrpcPorts>();

  return {
    router: (mount) => createEvaluatorTrpcRouter({ ...mount, ports }),
    app: refuseEvery<EvaluatorApp>(),
    ports,
  };
}

/** The evaluator graph reached on a process that composed none. */
class ApiEvaluatorUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "The evaluator surface is not available on this deployment.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiEvaluatorUnavailableError";
  }
}

/**
 * Everything an evaluator reaches that the evaluator package does not own. Four of the
 * six are row reads on the process's own connection — the linked workflow, the monitors
 * running this evaluator, their deletion, and archiving the graph.
 */
function composeEvaluatorPorts(options: EvaluatorFeatureCollaborators): EvaluatorTrpcPorts {
  const { prisma, workflows } = options;

  const deleteReplicatedWorkflow = async (
    _ctx: unknown,
    { workflowId, projectId }: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void> => {
    // `deleteMany` rather than `delete` so the multitenancy guard accepts the
    // project scope: a bare `{ id }` delete is rejected and the rollback below
    // silently no-ops.
    await prisma.workflow.deleteMany({ where: { id: workflowId, projectId } });
  };

  return {
    findLinkedWorkflow: (_ctx, { workflowId, projectId }) =>
      prisma.workflow.findFirst({
        where: { id: workflowId, projectId, archivedAt: null },
        select: { id: true, name: true },
      }),
    findMonitorsUsingEvaluator: (_ctx, { evaluatorId, projectId }) =>
      prisma.monitor.findMany({
        where: { evaluatorId, projectId },
        select: { id: true, name: true },
      }),
    deleteMonitorsUsingEvaluator: (_ctx, { evaluatorId, projectId }) =>
      prisma.monitor.deleteMany({ where: { evaluatorId, projectId } }),
    archiveLinkedWorkflow: (_ctx, { workflowId, projectId }) =>
      prisma.workflow.update({
        where: { id: workflowId, projectId },
        data: { archivedAt: new Date() },
      }),
    replicateEvaluatorWorkflow: async (ctx, { workflowId, sourceProjectId, targetProjectId }) => {
      const workflow = await prisma.workflow.findFirst({
        where: { id: workflowId, projectId: sourceProjectId, archivedAt: null },
        include: { latestVersion: true },
      });

      // Refused rather than copied: an evaluator created against a graph with
      // no saved version is a structurally broken replica, and the break only
      // shows up when somebody runs it.
      if (!workflow?.latestVersion?.dsl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot replicate a workflow evaluator without a saved workflow version",
        });
      }

      const { workflowId: newWorkflowId, dsl } = await workflows.copyStudioWorkflow({
        workflow: {
          id: workflow.id,
          name: workflow.name,
          icon: workflow.icon,
          description: workflow.description,
          isEvaluator: workflow.isEvaluator,
          isComponent: workflow.isComponent,
          latestVersion: workflow.latestVersion,
        },
        targetProjectId,
        sourceProjectId,
        copiedFromWorkflowId: workflowId,
      } as Parameters<WorkflowApp["copyStudioWorkflow"]>[0]);

      try {
        await workflows.saveStudioVersion(
          {
            projectId: targetProjectId,
            workflowId: newWorkflowId,
            dsl,
            autoSaved: false,
            commitMessage: "Copied from " + workflow.name,
          },
          { id: (ctx as unknown as ApiTrpcPortsContext).actor().id },
        );
      } catch (saveError) {
        await deleteReplicatedWorkflow(ctx, {
          workflowId: newWorkflowId,
          projectId: targetProjectId,
        }).catch(() => undefined);
        throw saveError;
      }

      return newWorkflowId;
    },
    deleteReplicatedWorkflow,
  };
}

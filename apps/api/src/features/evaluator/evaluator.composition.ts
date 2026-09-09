/**
 * The evaluators a project defines, installed over this process's own graph.
 * `evaluators.*` and `/api/evaluators` both reach the one application this
 * file builds, and the process publishes it as the `ctx.app.evaluatorApp`
 * slice.
 */
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import { EvaluatorWorkflowVersionRequiredError } from "@langwatch/evaluator-contract";
import {
  evaluatorServer,
  type EvaluatorActor,
  type EvaluatorGraph,
} from "@langwatch/evaluator-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createApp } from "@langwatch/runtime-composition";
import { nowInstant, toDate } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { WorkflowApp, WorkflowNlpRuntimePort } from "@langwatch/workflow-server";
import { nanoid } from "nanoid";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { createEvaluatorTrpcRouter } from "./evaluator-trpc.mount.ts";
import type { ComposedEvaluatorFeature } from "./evaluator.composition.types.ts";

/** The other modules' services the evaluator surface reaches, named one by one. */
export type EvaluatorPeers = Readonly<{
  /**
   * The workflow service an evaluator's published graph, its entry fields and
   * its code run are read through. Not `WorkflowApi`: that publishes neither
   * `getFields` nor `enrichStudioEvent`.
   */
  workflows: WorkflowService;
  /** Where a code evaluator executes. */
  nlpRuntime: WorkflowNlpRuntimePort;
  /**
   * The workflow application a WORKFLOW evaluator's graph is replicated
   * through. The studio DSL, its dataset references and its version history
   * are Workflow's, and neither the evaluator nor the monitor package reaches
   * into them. Read late, because the workflow application takes this
   * module's app as a peer of its own.
   */
  workflowApp: () => WorkflowApp;
  /**
   * The model gateway. It resolves a project's default and embeddings models
   * when an evaluator is created without naming them.
   */
  modelProviders: ModelProviderService;
  /** Answers whether a caller may act in a project other than the request's. */
  permissions: AuthzApiContract;
  /** Names the person behind each row of one evaluator's change history. */
  users: UserApi;
}>;

/** Installs the evaluator surface over this process's own graph. */
export async function installApiEvaluator(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: EvaluatorPeers;
}): Promise<ComposedEvaluatorFeature> {
  const { infrastructure, peers } = options;

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: infrastructure.prisma })
    .withInfrastructure({})
    .withProvided(AuthzApi, peers.permissions)
    .withProvided(AuditLogApi, infrastructure.auditLog)
    .withModule(evaluatorServer, {
      infrastructure: {
        workflows: peers.workflows,
        actors: apiEvaluatorActors(peers.users),
        graph: ProcessEvaluatorGraph.create({
          prisma: infrastructure.prisma,
          workflows: peers.workflowApp,
        }),
        nlp: peers.nlpRuntime,
        modelProviders: peers.modelProviders,
        generateId: () => nanoid(),
      },
    })
    .boot({ role: "api" });

  const app = runtime.module(evaluatorServer).provided;

  return {
    router: (mount) => createEvaluatorTrpcRouter(mount.runtime),
    app,
    evaluators: app.getRuntime(),
    restServices: { evaluators: () => app },
  };
}

/**
 * Who made each change, off the process's own user directory. Three fields,
 * because three fields are what a history row renders.
 */
function apiEvaluatorActors(users: UserApi) {
  return {
    findByIds: async (input: { userIds: string[] }): Promise<EvaluatorActor[]> => {
      const profiles = await users.getProfiles({ userIds: input.userIds });

      return profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        email: profile.email,
      }));
    },
  };
}

/**
 * Everything an evaluator reaches that the evaluator module does not own. Four
 * of the six are row reads on the process's own connection - the linked
 * workflow, the monitors running this evaluator, their deletion, and archiving
 * the graph.
 */
class ProcessEvaluatorGraph implements EvaluatorGraph {
  static create(options: {
    prisma: ApiTrpcInfrastructure["prisma"];
    workflows: () => WorkflowApp;
  }): ProcessEvaluatorGraph {
    return new ProcessEvaluatorGraph(options.prisma, options.workflows);
  }

  private constructor(
    private readonly prisma: ApiTrpcInfrastructure["prisma"],
    private readonly workflows: () => WorkflowApp,
  ) {}

  findLinkedWorkflow(input: Readonly<{ workflowId: string; projectId: string }>) {
    return this.prisma.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
      select: { id: true, name: true },
    });
  }

  findMonitorsUsingEvaluator(input: Readonly<{ evaluatorId: string; projectId: string }>) {
    return this.prisma.monitor.findMany({
      where: { evaluatorId: input.evaluatorId, projectId: input.projectId },
      select: { id: true, name: true },
    });
  }

  deleteMonitorsUsingEvaluator(input: Readonly<{ evaluatorId: string; projectId: string }>) {
    return this.prisma.monitor.deleteMany({
      where: { evaluatorId: input.evaluatorId, projectId: input.projectId },
    });
  }

  archiveLinkedWorkflow(input: Readonly<{ workflowId: string; projectId: string }>) {
    return this.prisma.workflow.update({
      where: { id: input.workflowId, projectId: input.projectId },
      data: { archivedAt: toDate(nowInstant()) },
    });
  }

  /**
   * Refused rather than copied when the graph has no saved version: an
   * evaluator created against one is a structurally broken replica, and the
   * break only shows up when somebody runs it.
   */
  async replicateEvaluatorWorkflow(
    input: Readonly<{
      workflowId: string;
      sourceProjectId: string;
      targetProjectId: string;
      actorId: string;
    }>,
  ): Promise<string> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.sourceProjectId, archivedAt: null },
      include: { latestVersion: true },
    });

    if (!workflow?.latestVersion?.dsl) {
      throw new EvaluatorWorkflowVersionRequiredError(input.workflowId);
    }

    const workflows = this.workflows();
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
      targetProjectId: input.targetProjectId,
      sourceProjectId: input.sourceProjectId,
      copiedFromWorkflowId: input.workflowId,
    } as Parameters<WorkflowApp["copyStudioWorkflow"]>[0]);

    try {
      await workflows.saveStudioVersion(
        {
          projectId: input.targetProjectId,
          workflowId: newWorkflowId,
          dsl,
          autoSaved: false,
          commitMessage: "Copied from " + workflow.name,
        },
        { id: input.actorId },
      );
    } catch (saveError) {
      await this.deleteReplicatedWorkflow({
        workflowId: newWorkflowId,
        projectId: input.targetProjectId,
      }).catch(() => void 0);

      throw saveError;
    }

    return newWorkflowId;
  }

  /**
   * `deleteMany` rather than `delete` so the multitenancy guard accepts the
   * project scope: a bare `{ id }` delete is rejected and this rollback would
   * silently no-op.
   */
  async deleteReplicatedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void> {
    await this.prisma.workflow.deleteMany({
      where: { id: input.workflowId, projectId: input.projectId },
    });
  }
}

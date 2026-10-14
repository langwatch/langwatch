/**
 * The server half of `workflow.*`. Five of its procedures act on a SECOND
 * project the declared check cannot cover; the module probes it.
 * Spec: modules/workflow/specs/workflow-service.feature.
 */
import type { AgentApiCopyRequest, AgentCopyCreated } from "@langwatch/agent-contract";
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { moduleApi } from "@langwatch/module";
import {
  historyEntryWithoutHttpAgentSecrets,
  versionWithoutHttpAgentSecrets,
  workflowTrpc,
  workflowWithoutHttpAgentSecrets,
  type WorkflowApi,
  type WorkflowCaller,
} from "@langwatch/workflow-contract";

/** What the workflow browser door reaches: the workflow application, and the agent copy. */
export interface WorkflowBrowserApi {
  /** This module's own application, as the process composed it. */
  workflows(): WorkflowApi;
  /** Copies an agent into the input's project; a workflow agent brings a copy of its graph. */
  copyAgent(input: AgentApiCopyRequest, by: WorkflowCaller): Promise<AgentCopyCreated>;
}

export const WorkflowBrowserApi = moduleApi<WorkflowBrowserApi>()("workflow");

/** How much of each version a history read carries back. */
function historyModeFor(
  returnDsl: boolean | "previousVersion" | undefined,
): "allDsl" | "previousDsl" | "metadata" {
  if (returnDsl === true) return "allDsl" as const;
  if (returnDsl === "previousVersion") return "previousDsl" as const;

  return "metadata" as const;
}

export const workflowTrpcTransport: TrpcRouterDeclaration<WorkflowBrowserApi, typeof workflowTrpc> =
  defineTrpcRouter(WorkflowBrowserApi, workflowTrpc)
    .procedure("engineMode")
    .withPermission("workflows:view")
    .handle(() => ({ engineMode: "go" as const, optimizeEnabled: false as const }))

    .procedure("create")
    .withPermission("workflows:create")
    .handle(async ({ app, input, actor }) => {
      const dsl = await app
        .workflows()
        .prepareStudioDsl({ projectId: input.projectId, dsl: input.dsl });

      return app.workflows().create(
        {
          projectId: input.projectId,
          dsl,
          commitMessage: input.commitMessage,
          publish: input.publish,
        },
        actor,
      );
    })

    .procedure("copy")
    .withPermission("workflows:create")
    .handle(({ app, input, actor }) =>
      app.workflows().copyFromPermittedSource(
        {
          sourceWorkflowId: input.workflowId,
          targetProjectId: input.projectId,
          sourceProjectId: input.sourceProjectId,
          copyDatasets: input.copyDatasets,
          copiedFromWorkflowId: input.workflowId,
        },
        actor,
      ),
    )

    .procedure("getAll")
    .withPermission("workflows:view")
    .handle(({ app, input, actor }) =>
      app.workflows().listWithCopyLineage({ projectId: input.projectId, viewerUserId: actor.id }),
    )

    .procedure("getCopies")
    .withPermission("workflows:view")
    .handle(({ app, input, actor }) => app.workflows().listPermittedCopies(input, actor))

    .procedure("getById")
    .withPermission("workflows:view")
    .handle(async ({ app, input }) =>
      workflowWithoutHttpAgentSecrets(await app.workflows().getWithMigratedDsl(input)),
    )

    .procedure("getVersions")
    .withPermission("workflows:view")
    .handle(async ({ app, input }) =>
      (
        await app.workflows().getVersionHistory({
          workflowId: input.workflowId,
          projectId: input.projectId,
          mode: historyModeFor(input.returnDSL),
        })
      ).map(historyEntryWithoutHttpAgentSecrets),
    )

    .procedure("restoreVersion")
    .withPermission("workflows:update")
    .handle(async ({ app, input }) =>
      versionWithoutHttpAgentSecrets(
        await app
          .workflows()
          .restoreVersion({ versionId: input.versionId, projectId: input.projectId }),
      ),
    )

    .procedure("autosave")
    .withPermission("workflows:update")
    .handle(({ app, input, actor }) =>
      app.workflows().saveStudioVersion(
        {
          projectId: input.projectId,
          workflowId: input.workflowId,
          dsl: input.dsl,
          autoSaved: true,
          commitMessage: "Autosaved",
          setAsLatestVersion: input.setAsLatestVersion,
        },
        actor,
      ),
    )

    .procedure("commitVersion")
    .withPermission("workflows:update")
    .handle(({ app, input, actor }) =>
      app.workflows().saveStudioVersion(
        {
          projectId: input.projectId,
          workflowId: input.workflowId,
          dsl: input.dsl,
          autoSaved: false,
          commitMessage: input.commitMessage,
        },
        actor,
      ),
    )

    .procedure("publish")
    .withPermission("workflows:update")
    .handle(({ app, input, actor }) =>
      app
        .workflows()
        .publish(
          { id: input.workflowId, projectId: input.projectId, versionId: input.versionId },
          actor,
        ),
    )

    .procedure("unpublish")
    .withPermission("workflows:update")
    .handle(({ app, input }) =>
      app.workflows().unpublish({ id: input.workflowId, projectId: input.projectId }),
    )

    .procedure("syncFromSource")
    .withPermission("workflows:update")
    .handle(({ app, input, actor }) => app.workflows().syncFromSource(input, actor))

    .procedure("pushToCopies")
    .withPermission("workflows:update")
    .handle(({ app, input, actor }) => app.workflows().pushToCopies(input, actor))

    .procedure("getRelatedEntities")
    .withPermission("workflows:view")
    .handle(({ app, input }) => app.workflows().getRelatedEntities(input))

    .procedure("cascadeArchive")
    .withPermission("workflows:delete")
    .handle(({ app, input }) =>
      app.workflows().cascadeArchive({
        projectId: input.projectId,
        workflowId: input.workflowId,
        unarchive: input.unarchive,
      }),
    )

    .procedure("archive")
    .withPermission("workflows:delete")
    .handle(({ app, input }) =>
      app.workflows().archive({
        id: input.workflowId,
        projectId: input.projectId,
        unarchive: input.unarchive,
      }),
    )

    .procedure("generateCommitMessage")
    .withPermission("workflows:update")
    .handle(({ app, input }) => app.workflows().generateCommitMessage(input))

    .procedure("copyAgent")
    .withPermission("evaluations:manage")
    .handle(({ app, input, actor }) => app.copyAgent(input, actor))
    .build();

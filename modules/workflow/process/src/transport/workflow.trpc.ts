/**
 * The server half of `workflow.*`. Four of its procedures act on a SECOND
 * project the declared check cannot cover; the module probes it.
 * Spec: modules/workflow/specs/workflow-service.feature.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  historyEntryWithoutHttpAgentSecrets,
  versionWithoutHttpAgentSecrets,
  WorkflowApi,
  workflowTrpc,
  workflowWithoutHttpAgentSecrets,
} from "@langwatch/workflow-contract";

/** How much of each version a history read carries back. */
function historyModeFor(
  returnDsl: boolean | "previousVersion" | undefined,
): "allDsl" | "previousDsl" | "metadata" {
  if (returnDsl === true) return "allDsl" as const;
  if (returnDsl === "previousVersion") return "previousDsl" as const;

  return "metadata" as const;
}

export const workflowTrpcTransport: TrpcRouterDeclaration<WorkflowApi, typeof workflowTrpc> =
  defineTrpcRouter(WorkflowApi, workflowTrpc)
    .procedure("engineMode")
    .withPermission("workflows:view")
    .handle(() => ({ engineMode: "go" as const, optimizeEnabled: false as const }))

    .procedure("create")
    .withPermission("workflows:create")
    .handle(async ({ app, input, actor }) => {
      const dsl = await app.prepareStudioDsl({ projectId: input.projectId, dsl: input.dsl });

      return app.create(
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
      app.copyFromPermittedSource(
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
      app.listWithCopyLineage({ projectId: input.projectId, viewerUserId: actor.id }),
    )

    .procedure("getCopies")
    .withPermission("workflows:view")
    .handle(({ app, input, actor }) => app.listPermittedCopies(input, actor))

    .procedure("getById")
    .withPermission("workflows:view")
    .handle(async ({ app, input }) =>
      workflowWithoutHttpAgentSecrets(await app.getWithMigratedDsl(input)),
    )

    .procedure("getVersions")
    .withPermission("workflows:view")
    .handle(async ({ app, input }) =>
      (
        await app.getVersionHistory({
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
        await app.restoreVersion({ versionId: input.versionId, projectId: input.projectId }),
      ),
    )

    .procedure("autosave")
    .withPermission("workflows:update")
    .handle(({ app, input, actor }) =>
      app.saveStudioVersion(
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
      app.saveStudioVersion(
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
      app.publish(
        { id: input.workflowId, projectId: input.projectId, versionId: input.versionId },
        actor,
      ),
    )

    .procedure("unpublish")
    .withPermission("workflows:update")
    .handle(({ app, input }) => app.unpublish({ id: input.workflowId, projectId: input.projectId }))

    .procedure("syncFromSource")
    .withPermission("workflows:update")
    .handle(({ app, input, actor }) => app.syncFromSource(input, actor))

    .procedure("pushToCopies")
    .withPermission("workflows:update")
    .handle(({ app, input, actor }) => app.pushToCopies(input, actor))

    .procedure("getRelatedEntities")
    .withPermission("workflows:view")
    .handle(({ app, input }) => app.getRelatedEntities(input))

    .procedure("cascadeArchive")
    .withPermission("workflows:delete")
    .handle(({ app, input }) =>
      app.cascadeArchive({
        projectId: input.projectId,
        workflowId: input.workflowId,
        unarchive: input.unarchive,
      }),
    )

    .procedure("archive")
    .withPermission("workflows:delete")
    .handle(({ app, input }) =>
      app.archive({
        id: input.workflowId,
        projectId: input.projectId,
        unarchive: input.unarchive,
      }),
    )

    .procedure("generateCommitMessage")
    .withPermission("workflows:update")
    .handle(({ app, input }) => app.generateCommitMessage(input))
    .build();

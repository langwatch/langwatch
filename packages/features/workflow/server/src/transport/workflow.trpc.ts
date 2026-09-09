/**
 * The server half of `workflow.*`. Four of its procedures act on a SECOND
 * project the declared check cannot cover, and probe it themselves.
 * Spec: packages/features/workflow/specs/workflow-service.feature.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  migrateDSLVersion,
  parseStudioWorkflow,
  WorkflowApi,
  workflowTrpc,
  WorkflowNotFoundError,
  WorkflowVersionNotFoundError,
  type StudioWorkflow,
  type WorkflowVersion,
} from "@langwatch/workflow-contract";
import { TRPCError } from "@trpc/server";

/** The next major version a copy takes, counted from its OWN history. */
function nextMajorVersion(current: string | null | undefined): string {
  const [versionMajor] = (current ?? "0.0").split(".");

  return `${parseInt(versionMajor ?? "0") + 1}`;
}

/** Deep-clones a persisted graph so the caller may mutate it freely. */
function cloneDsl(dsl: unknown): StudioWorkflow {
  return parseStudioWorkflow(JSON.parse(JSON.stringify(dsl)));
}

/** How much of each version a history read carries back. */
function historyModeFor(returnDsl: boolean | "previousVersion" | undefined) {
  if (returnDsl === true) return "allDsl" as const;
  if (returnDsl === "previousVersion") return "previousDsl" as const;

  return "metadata" as const;
}

/** The one refusal four procedures share, raised fresh so each carries its own stack. */
function workflowNotFound(): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });
}

export const workflowTrpcTransport = defineTrpcRouter(WorkflowApi, workflowTrpc)
  .procedure("engineMode")
  .withPermission("workflows:view")
  .handle(() => ({ engineMode: "go" as const, optimizeEnabled: false as const }))

  .procedure("create")
  .withPermission("workflows:create")
  .handle(async ({ app, input, actor }) => {
    const dsl = await app.prepareStudioDsl({ projectId: input.projectId, dsl: input.dsl });

    return await app.create(
      {
        projectId: input.projectId,
        dsl,
        commitMessage: input.commitMessage,
        publish: input.publish,
      },
      actor,
    );
  })

  // Copying reaches into a SECOND project, which the declared check on
  // `projectId` does not cover - so the caller must also be able to create
  // workflows in the source project.
  .procedure("copy")
  .withPermission("workflows:create")
  .handle(async ({ app, input, actor }) => {
    const hasSourcePermission = await app.hasProjectPermission({
      userId: actor.id,
      projectId: input.sourceProjectId,
      permission: "workflows:create",
    });

    if (!hasSourcePermission) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You do not have permission to create workflows in the source project",
      });
    }

    return await app.copy(
      {
        sourceWorkflowId: input.workflowId,
        targetProjectId: input.projectId,
        sourceProjectId: input.sourceProjectId,
        copyDatasets: input.copyDatasets,
        copiedFromWorkflowId: input.workflowId,
      },
      actor,
    );
  })

  .procedure("getAll")
  .withPermission("workflows:view")
  .handle(({ app, input, actor }) =>
    app.listWithCopyLineage({ projectId: input.projectId, viewerUserId: actor.id }),
  )

  /**
   * The copies of a workflow the caller could actually push to. A copy in a
   * project they cannot update is withheld rather than shown greyed out,
   * because the only action the list offers is a push.
   */
  .procedure("getCopies")
  .withPermission("workflows:view")
  .handle(async ({ app, input, actor }) => {
    const workflow = await app.findWorkflowOwner(input);

    if (!workflow) throw workflowNotFound();

    const hasPermission = await app.hasProjectPermission({
      userId: actor.id,
      projectId: workflow.projectId,
      permission: "workflows:view",
    });

    if (!hasPermission) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You do not have permission to view this workflow",
      });
    }

    const copies = await app.findCopiesWithPath(input);

    if (!copies) throw workflowNotFound();

    const copiesWithPermissions = await Promise.all(
      copies.map(async (copy) => ({
        id: copy.id,
        name: copy.name,
        projectId: copy.projectId,
        projectName: copy.project.name,
        teamName: copy.project.team.name,
        organizationName: copy.project.team.organization.name,
        fullPath: `${copy.project.team.organization.name} / ${copy.project.team.name} / ${copy.project.name}`,
        hasPermission: await app.hasProjectPermission({
          userId: actor.id,
          projectId: copy.projectId,
          permission: "workflows:update",
        }),
      })),
    );

    // An empty result is the same answer whether there are no copies or none
    // the caller may update: the page renders "No copies found" either way
    // rather than naming a project they cannot see.
    return copiesWithPermissions.filter((copy) => copy.hasPermission);
  })

  .procedure("getById")
  .withPermission("workflows:view")
  .handle(async ({ app, input }) => {
    const workflow = await app
      .getById({ id: input.workflowId, projectId: input.projectId, includeVersion: true })
      .catch((error: unknown) => {
        if (error instanceof WorkflowNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }

        throw error;
      });

    if (workflow.currentVersion) {
      workflow.currentVersion.dsl = migrateDSLVersion(workflow.currentVersion.dsl);
    }

    return workflow;
  })

  .procedure("getVersions")
  .withPermission("workflows:view")
  .handle(({ app, input }) =>
    app
      .getVersionHistory({
        workflowId: input.workflowId,
        projectId: input.projectId,
        mode: historyModeFor(input.returnDSL),
      })
      .catch((error: unknown) => {
        if (!(error instanceof WorkflowNotFoundError)) throw error;

        throw workflowNotFound();
      }),
  )

  .procedure("restoreVersion")
  .withPermission("workflows:update")
  .handle(({ app, input }) =>
    app
      .restoreVersion({ versionId: input.versionId, projectId: input.projectId })
      .catch((error: unknown) => {
        if (
          !(error instanceof WorkflowVersionNotFoundError) &&
          !(error instanceof WorkflowNotFoundError)
        ) {
          throw error;
        }

        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            error instanceof WorkflowVersionNotFoundError
              ? "Workflow version not found"
              : "Workflow not found",
        });
      }),
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

  /**
   * Pulls the source workflow's latest graph into this copy as a new version.
   * The version number continues THIS copy's history, not the source's, so a
   * copy that has diverged does not jump backwards.
   */
  .procedure("syncFromSource")
  .withPermission("workflows:update")
  .handle(async ({ app, input, actor }) => {
    const workflow = await app.findWorkflowWithSource(input);

    if (!workflow) throw workflowNotFound();

    if (!workflow.copiedFromWorkflowId || !workflow.copiedFrom) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This workflow is not a copy and has no source to sync from",
      });
    }

    if (workflow.copiedFrom.archivedAt) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Source workflow has been archived" });
    }

    const sourceWorkflow = workflow.copiedFrom;

    if (!sourceWorkflow.latestVersion?.dsl) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Source workflow or its latest version not found",
      });
    }

    const hasSourcePermission = await app.hasProjectPermission({
      userId: actor.id,
      projectId: sourceWorkflow.projectId,
      permission: "workflows:view",
    });

    if (!hasSourcePermission) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You do not have permission to view workflows in the source project",
      });
    }

    const nextVersion = nextMajorVersion(workflow.latestVersion?.version);
    const dsl = cloneDsl(sourceWorkflow.latestVersion.dsl);

    dsl.workflow_id = workflow.id;

    const version = await app.saveStudioVersion(
      {
        projectId: input.projectId,
        workflowId: input.workflowId,
        dsl: { ...dsl, version: nextVersion },
        autoSaved: false,
        commitMessage: "Updated from source workflow",
      },
      actor,
    );

    return { workflow, version };
  })

  /**
   * Pushes this workflow's latest graph out to its copies. Copies in projects
   * the caller cannot update are skipped silently; if that leaves nothing, the
   * whole push is refused rather than reported as a no-op.
   */
  .procedure("pushToCopies")
  .withPermission("workflows:update")
  .handle(async ({ app, input, actor }) => {
    const workflow = await app.findWorkflowWithCopies(input);

    if (!workflow) throw workflowNotFound();

    if (!workflow.latestVersion?.dsl) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This workflow has no latest version to push",
      });
    }

    if (workflow.copiedWorkflows.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This workflow has no copies to push to",
      });
    }

    const copyIds = input.copyIds;
    const copiesToPush = copyIds
      ? workflow.copiedWorkflows.filter((copy) => copyIds.includes(copy.id))
      : workflow.copiedWorkflows;

    if (copiesToPush.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No valid copies selected to push to",
      });
    }

    const dsl = cloneDsl(workflow.latestVersion.dsl);
    const results: { copyId: string; copyName: string; version: WorkflowVersion }[] = [];

    for (const copy of copiesToPush) {
      const hasCopyPermission = await app.hasProjectPermission({
        userId: actor.id,
        projectId: copy.projectId,
        permission: "workflows:update",
      });

      if (!hasCopyPermission) continue;

      // Each copy keeps its own version history, so the next number is read
      // from the copy rather than from the source being pushed.
      const copyLatest = await app.findLatestVersionNumber({
        workflowId: copy.id,
        projectId: copy.projectId,
      });

      if (!copyLatest) continue;

      const copyDsl = cloneDsl(dsl);

      copyDsl.workflow_id = copy.id;

      const version = await app.saveStudioVersion(
        {
          projectId: copy.projectId,
          workflowId: copy.id,
          dsl: { ...copyDsl, version: nextMajorVersion(copyLatest.version) },
          autoSaved: false,
          commitMessage: "Updated from source workflow",
        },
        actor,
      );

      results.push({ copyId: copy.id, copyName: copy.name, version });
    }

    if (results.length === 0) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You do not have permission to update any of the copied workflows",
      });
    }

    return {
      pushedTo: results.length,
      totalCopies: workflow.copiedWorkflows.length,
      selectedCopies: copiesToPush.length,
      results,
    };
  })

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

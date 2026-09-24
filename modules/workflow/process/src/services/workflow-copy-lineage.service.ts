/**
 * Copy lineage across projects: copying, listing, syncing and pushing.
 * Spec: modules/workflow/specs/workflow-service.feature.
 */
import {
  WorkflowHasNoCopiesError,
  WorkflowHasNoLatestVersionError,
  WorkflowNoCopiesSelectedError,
  WorkflowNotACopyError,
  WorkflowNotFoundError,
  WorkflowPermissionDeniedError,
  type CopyWorkflowCommand,
  type WorkflowCaller,
  type WorkflowCopyRow,
  type WorkflowPushToCopies,
  type WorkflowSourceRow,
  type WorkflowVersion,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";

import type { WorkflowLineageReads, WorkflowPermissionProbe } from "../app/workflow.app.ts";
import { cloneDsl, nextMajorVersion } from "../rules/workflow-copy-version.rules.ts";
import type { WorkflowStudioVersionService } from "./workflow-studio-version.service.ts";
import type { WorkflowService } from "./workflow.service.ts";

export type WorkflowCopyLineageServiceOptions = {
  lineage: Pick<
    WorkflowLineageReads,
    | "findWorkflow"
    | "findCopiesWithPath"
    | "findWorkflowWithSource"
    | "findWorkflowWithCopies"
    | "findLatestVersionNumber"
  >;
  permissions: Pick<WorkflowPermissionProbe, "has">;
  workflows: Pick<WorkflowService, "copy">;
  studioVersions: Pick<WorkflowStudioVersionService, "saveOrCommit">;
};

type WorkflowReference = { workflowId: string; projectId: string };

export class WorkflowCopyLineageService {
  static create(options: WorkflowCopyLineageServiceOptions): WorkflowCopyLineageService {
    return new WorkflowCopyLineageService(options);
  }

  private constructor(private readonly options: WorkflowCopyLineageServiceOptions) {}

  /**
   * Copying reaches into a SECOND project, which the declared check on the
   * target does not cover - so the caller must also be able to create
   * workflows in the source project.
   */
  async copyFromPermittedSource(
    input: Omit<CopyWorkflowCommand, "authorId">,
    by: WorkflowCaller,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }> {
    const hasSourcePermission = await this.options.permissions.has({
      userId: by.id,
      projectId: input.sourceProjectId,
      permission: "workflows:create",
    });

    if (!hasSourcePermission) {
      throw new WorkflowPermissionDeniedError({
        permission: "workflows:create",
        message: "You do not have permission to create workflows in the source project",
      });
    }

    return this.options.workflows.copy({ ...input, authorId: by.id });
  }

  /**
   * The copies of a workflow the caller could actually push to. A copy in a
   * project they cannot update is withheld rather than shown greyed out,
   * because the only action the list offers is a push.
   */
  async listPermittedCopies(
    input: WorkflowReference,
    by: WorkflowCaller,
  ): Promise<WorkflowCopyRow[]> {
    const workflow = await this.options.lineage.findWorkflow(input);

    if (!workflow) throw new WorkflowNotFoundError(input.workflowId, input.projectId);

    const hasPermission = await this.options.permissions.has({
      userId: by.id,
      projectId: workflow.projectId,
      permission: "workflows:view",
    });

    if (!hasPermission) {
      throw new WorkflowPermissionDeniedError({
        permission: "workflows:view",
        message: "You do not have permission to view this workflow",
      });
    }

    const copies = await this.options.lineage.findCopiesWithPath(input);

    if (!copies) throw new WorkflowNotFoundError(input.workflowId, input.projectId);

    const copiesWithPermissions = await Promise.all(
      copies.map(async (copy) => ({
        id: copy.id,
        name: copy.name,
        projectId: copy.projectId,
        projectName: copy.project.name,
        teamName: copy.project.team.name,
        organizationName: copy.project.team.organization.name,
        fullPath: `${copy.project.team.organization.name} / ${copy.project.team.name} / ${copy.project.name}`,
        hasPermission: await this.options.permissions.has({
          userId: by.id,
          projectId: copy.projectId,
          permission: "workflows:update",
        }),
      })),
    );

    // An empty result is the same answer whether there are no copies or none
    // the caller may update: the page renders "No copies found" either way.
    return copiesWithPermissions.filter((copy) => copy.hasPermission);
  }

  /**
   * Pulls the source workflow's latest graph into this copy as a new version.
   * The version number continues THIS copy's history, not the source's, so a
   * copy that has diverged does not jump backwards.
   */
  async syncFromSource(
    input: WorkflowReference,
    by: WorkflowCaller,
  ): Promise<{ workflow: WorkflowSourceRow; version: WorkflowVersion }> {
    const workflow = await this.options.lineage.findWorkflowWithSource(input);

    if (!workflow) throw new WorkflowNotFoundError(input.workflowId, input.projectId);

    if (!workflow.copiedFromWorkflowId || !workflow.copiedFrom) {
      throw new WorkflowNotACopyError();
    }

    const sourceWorkflow = workflow.copiedFrom;

    if (sourceWorkflow.archivedAt || !sourceWorkflow.latestVersion?.dsl) {
      throw new WorkflowNotFoundError(sourceWorkflow.id, sourceWorkflow.projectId);
    }

    const hasSourcePermission = await this.options.permissions.has({
      userId: by.id,
      projectId: sourceWorkflow.projectId,
      permission: "workflows:view",
    });

    if (!hasSourcePermission) {
      throw new WorkflowPermissionDeniedError({
        permission: "workflows:view",
        message: "You do not have permission to view workflows in the source project",
      });
    }

    const dsl = cloneDsl(sourceWorkflow.latestVersion.dsl);

    dsl.workflow_id = workflow.id;

    const version = await this.options.studioVersions.saveOrCommit({
      projectId: input.projectId,
      workflowId: input.workflowId,
      dsl: { ...dsl, version: nextMajorVersion(workflow.latestVersion?.version) },
      autoSaved: false,
      commitMessage: "Updated from source workflow",
      authorId: by.id,
    });

    return { workflow, version };
  }

  /**
   * Pushes this workflow's latest graph out to its copies. Copies in projects
   * the caller cannot update are skipped silently; if that leaves nothing, the
   * whole push is refused rather than reported as a no-op.
   */
  async pushToCopies(
    input: WorkflowReference & { copyIds?: string[] },
    by: WorkflowCaller,
  ): Promise<WorkflowPushToCopies> {
    const workflow = await this.options.lineage.findWorkflowWithCopies(input);

    if (!workflow) throw new WorkflowNotFoundError(input.workflowId, input.projectId);

    if (!workflow.latestVersion?.dsl) throw new WorkflowHasNoLatestVersionError();

    if (workflow.copiedWorkflows.length === 0) throw new WorkflowHasNoCopiesError();

    const copyIds = input.copyIds;
    const copiesToPush = copyIds
      ? workflow.copiedWorkflows.filter((copy) => copyIds.includes(copy.id))
      : workflow.copiedWorkflows;

    if (copiesToPush.length === 0) throw new WorkflowNoCopiesSelectedError();

    const dsl = cloneDsl(workflow.latestVersion.dsl);
    const results: WorkflowPushToCopies["results"] = [];

    for (const copy of copiesToPush) {
      const hasCopyPermission = await this.options.permissions.has({
        userId: by.id,
        projectId: copy.projectId,
        permission: "workflows:update",
      });

      if (!hasCopyPermission) continue;

      // Each copy keeps its own version history, so the next number is read
      // from the copy rather than from the source being pushed.
      const copyLatest = await this.options.lineage.findLatestVersionNumber({
        workflowId: copy.id,
        projectId: copy.projectId,
      });

      if (!copyLatest) continue;

      const copyDsl = cloneDsl(dsl);

      copyDsl.workflow_id = copy.id;

      const version = await this.options.studioVersions.saveOrCommit({
        projectId: copy.projectId,
        workflowId: copy.id,
        dsl: { ...copyDsl, version: nextMajorVersion(copyLatest.version) },
        autoSaved: false,
        commitMessage: "Updated from source workflow",
        authorId: by.id,
      });

      results.push({ copyId: copy.id, copyName: copy.name, version });
    }

    if (results.length === 0) {
      throw new WorkflowPermissionDeniedError({
        permission: "workflows:update",
        message: "You do not have permission to update any of the copied workflows",
      });
    }

    return {
      pushedTo: results.length,
      totalCopies: workflow.copiedWorkflows.length,
      selectedCopies: copiesToPush.length,
      results,
    };
  }
}

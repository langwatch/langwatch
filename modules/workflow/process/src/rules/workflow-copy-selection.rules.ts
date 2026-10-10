import {
  dslWithoutHttpCredentials,
  type Workflow,
  type WorkflowVersion,
  type WorkflowDsl,
} from "@langwatch/workflow-contract";

/** A cloned graph bound for another project arrives with every HTTP credential blank. */
export function dslForTargetProject(input: {
  dsl: WorkflowDsl;
  sourceProjectId: string;
  targetProjectId: string;
}): WorkflowDsl {
  return input.sourceProjectId === input.targetProjectId
    ? input.dsl
    : dslWithoutHttpCredentials(input.dsl);
}

/** The graph a brand-new copy starts from: version one, no experiment, no studio state. */
export function freshCopyDsl(input: { dsl: WorkflowDsl; workflowId: string }): WorkflowDsl {
  return {
    ...input.dsl,
    workflow_id: input.workflowId,
    version: "1",
    experiment_id: "",
    state: {},
  };
}

/** The copies a push reaches: those named (all when none are) inside the allowed projects. */
export function selectCopiesToPush(input: {
  copies: Workflow[];
  copyIds?: string[];
  allowedProjectIds?: string[];
}): Workflow[] {
  return input.copies.filter(
    (copy) =>
      (!input.copyIds || input.copyIds.includes(copy.id)) &&
      (!input.allowedProjectIds || input.allowedProjectIds.includes(copy.projectId)),
  );
}

/** Each evaluator workflow narrowed to its published version. */
export function narrowToPublishedVersion(
  workflows: (Workflow & { versions: WorkflowVersion[] })[],
): (Workflow & { versions: WorkflowVersion[] })[] {
  return workflows.map((workflow) => ({
    ...workflow,
    versions: workflow.versions.filter((version) => version.id === workflow.publishedId),
  }));
}

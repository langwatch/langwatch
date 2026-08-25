export class WorkflowNotFoundError extends Error {
  readonly code = "workflow_not_found" as const;
  constructor(
    readonly workflowId: string,
    readonly projectId?: string,
  ) {
    super(`Workflow ${workflowId} not found.`);
    this.name = "WorkflowNotFoundError";
  }
}

export class WorkflowVersionNotFoundError extends Error {
  readonly code = "workflow_version_not_found" as const;
  constructor(readonly versionId: string) {
    super(`Workflow version ${versionId} not found.`);
    this.name = "WorkflowVersionNotFoundError";
  }
}

export class WorkflowNotPublishedError extends Error {
  readonly code = "workflow_not_published" as const;
  constructor(readonly workflowId: string) {
    super("Workflow not published.");
    this.name = "WorkflowNotPublishedError";
  }
}

export class WorkflowDslValidationError extends Error {
  readonly code = "workflow_dsl_invalid" as const;
  constructor(readonly issues: readonly unknown[]) {
    super("Workflow definition is invalid.");
    this.name = "WorkflowDslValidationError";
  }
}

export class WorkflowVersionRequiredError extends Error {
  readonly code = "workflow_version_required" as const;
  constructor() {
    super("This workflow has no committed version.");
    this.name = "WorkflowVersionRequiredError";
  }
}

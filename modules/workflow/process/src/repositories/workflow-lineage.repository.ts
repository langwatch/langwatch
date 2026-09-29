import type {
  Workflow,
  WorkflowCopiesRow,
  WorkflowCopyWithPath,
  WorkflowLineageRow,
  WorkflowPublicationFlags,
  WorkflowSourceRow,
} from "@langwatch/workflow-contract";

type WorkflowScope = Readonly<{ workflowId: string; projectId: string }>;

/**
 * A workflow's copy lineage in both directions and its publication flags, read off the
 * workflow table. A copy's path names its project, team and organization as a join.
 */
export abstract class WorkflowLineageRepository {
  /** Every non-archived workflow of the project, newest edit first. */
  abstract findWithCopyLineage(input: {
    projectId: string;
  }): Promise<readonly WorkflowLineageRow[]>;

  abstract findWorkflow(input: WorkflowScope): Promise<Readonly<{ projectId: string }> | null>;

  /** Null when the workflow itself is gone; its non-archived copies otherwise. */
  abstract findCopiesWithPath(
    input: WorkflowScope,
  ): Promise<readonly WorkflowCopyWithPath[] | null>;

  abstract findWorkflowWithSource(input: WorkflowScope): Promise<WorkflowSourceRow | null>;

  abstract findWorkflowWithCopies(input: WorkflowScope): Promise<WorkflowCopiesRow | null>;

  abstract findLatestVersionNumber(
    input: WorkflowScope,
  ): Promise<Readonly<{ version: string | null }> | null>;

  abstract findFlags(input: WorkflowScope): Promise<WorkflowPublicationFlags | null>;

  abstract findVersion(input: {
    versionId: string;
    projectId: string;
  }): Promise<Readonly<Record<string, unknown>> | null>;

  abstract setFlags(
    input: WorkflowScope & { isComponent?: boolean; isEvaluator?: boolean },
  ): Promise<void>;

  /** Components and evaluators, each carrying only the version it publishes. */
  abstract findPublishedComponents(input: {
    projectId: string;
  }): Promise<readonly (Workflow & { versions: readonly unknown[] })[]>;
}

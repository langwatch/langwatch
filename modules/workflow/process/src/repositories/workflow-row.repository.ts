/** Bare workflow row before its first version; the first write in a two-step copy. */
import type { WorkflowUsageCount } from "@langwatch/workflow-contract";

/** The stored workflow a copy lands in, before its first version exists. */
export type WorkflowRowDraft = {
  id: string;
  projectId: string;
  name: string;
  icon: string;
  description: string;
  isEvaluator: boolean;
  isComponent: boolean;
  copiedFromWorkflowId: string;
};

export abstract class WorkflowRowRepository {
  abstract create(input: WorkflowRowDraft): Promise<void>;

  /** The usage report's count, archived included; the caller never passes an empty project list. */
  abstract countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<WorkflowUsageCount>;
}

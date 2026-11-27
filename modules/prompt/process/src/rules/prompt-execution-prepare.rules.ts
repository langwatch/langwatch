import {
  LlmModelNotSetError,
  WorkflowModelProviderUnavailableError,
} from "@langwatch/workflow-contract";

/**
 * A playground run the person can fix in the editor or in settings: a node
 * with no model, or a provider that is not set up or is switched off. These
 * are refusals, not server faults, so they are not logged as errors.
 */
export function isEditorFixablePrepareError(error: unknown): boolean {
  return (
    error instanceof LlmModelNotSetError || error instanceof WorkflowModelProviderUnavailableError
  );
}

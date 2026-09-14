/**
 * The Workflows client — must stay as a single module to remain testable.
 */

export { workflowApi as api } from "./workflow-api.ts";
export type { RouterInputs, RouterOutputs, WorkflowApiRouter } from "./workflow-api.ts";

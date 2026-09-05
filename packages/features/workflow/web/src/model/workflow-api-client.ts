/**
 * The Workflows client under the name call sites already wrote. Must stay the single module — a second one over the same `createFeatureApi` client would give a consumer's test two clients, only one mockable.
 */

export { workflowApi as api } from "./workflow-api";
export type { RouterInputs, RouterOutputs, WorkflowApiRouter } from "./workflow-api";

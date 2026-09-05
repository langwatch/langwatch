/**
 * The Workflows client under the name its call sites already wrote.
 *
 * The optimization studio and every feature that shows workflow data write
 * `api.workflow.getById.useQuery(...)`, and this is the single module they all
 * resolve to — the package's own screens through this path, other web features
 * through `@langwatch/workflow-web/surfaces/workflow-api`. One module matters:
 * a second one over the same `createFeatureApi` client would hand a consumer's
 * test a client it can mock and a second one it cannot.
 */

export { workflowApi as api } from "./workflow-api";
export type { RouterInputs, RouterOutputs, WorkflowApiRouter } from "./workflow-api";

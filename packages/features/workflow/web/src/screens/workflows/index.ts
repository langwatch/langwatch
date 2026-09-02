/**
 * The Workflows family, as the browser application mounts it.
 *
 * TWO SCREENS, TWO ADDRESSES: `/:project/workflows` and
 * `/:project/chat/:workflow`.
 *
 * THE RANKING ROW SAID THREE KEYS AND TWO MOVED. `/:project/studio/:workflow`
 * stays in `platform/app`, and it is blocked on the size of its COPY set rather
 * than on ownership: the studio's exclusive closure is 39 files and 9,891 lines,
 * and moving it means copying 220 more files and 40,543 lines out of
 * `platform/app` — `~/server/tracer/tracesMapping` (1,415 lines, 31 importers,
 * the trace family's vocabulary), `components/traces/TracesMapping` (1,058),
 * `components/checks/DynamicZodForm` (663), the whole of `experiments-v3`
 * (~6,000), `components/datasets/UploadCSVDrawer` (1,421),
 * `components/prompts/PromptEditorDrawer` (1,279) and
 * `components/filters/FieldsFilters` (968, which names `~/server/api/root`,
 * `~/server/filters/registry` and `~/server/analytics/utils` — modules a
 * browser package may name none of). That is the same wall the evaluations
 * family recorded for `evaluations/:id/edit`, measured at five times the size,
 * and it comes down when the trace and experiment vocabularies are packaged.
 * Recorded with the numbers in `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * WHY THIS PACKAGE. The credentials family's rule, read strictly: a key belongs
 * to the family that owns its TRANSPORT. Every call on the list page is
 * `workflow.*` and every call on the chat page is `optimization.*`, both mounted
 * out of `@langwatch/workflow-server`, and every type either renders is
 * `@langwatch/workflow-contract`'s. Transport and types agree.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on, the `workflows:view` guard in front of the list, and
 * the host port that answers for the project, the reader's grants, the
 * replication targets, the address, the two notices and the navigation into the
 * studio.
 */

import type { ComponentType } from "react";

export type WorkflowScreenLoader = () => Promise<{ default: ComponentType }>;

export const workflowScreens = {
  workflows: () => import("./workflows.screen"),
  workflowChat: () => import("./workflow-chat.screen"),
} as const satisfies Record<string, WorkflowScreenLoader>;

export type WorkflowScreenName = keyof typeof workflowScreens;

export { WORKFLOWS_PAGE_PERMISSION } from "./workflows.screen";
export { workflowApi } from "../../behavior/workflow-api";
export type { WorkflowApiMap, WorkflowOrganizationGraph } from "../../behavior/workflow-api";
export {
  WorkflowHostPort,
  WorkflowHostProvider,
  type WorkflowCopyTarget,
  type WorkflowFailureNotice,
  type WorkflowRouteReading,
  type WorkflowScope,
  type WorkflowSuccessNotice,
} from "../../model/workflow-host";

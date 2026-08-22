import type { AuthzPermission } from "@langwatch/authz";
import type { z } from "zod";
import {
  addColumnPayloadSchema,
  addColumnResultSchema,
  addEvaluatorPayloadSchema,
  addEvaluatorResultSchema,
  addRowsPayloadSchema,
  addRowsResultSchema,
  addTargetPayloadSchema,
  addTargetResultSchema,
  duplicateTargetPayloadSchema,
  duplicateTargetResultSchema,
  getStatePayloadSchema,
  removeTargetPayloadSchema,
  removeTargetResultSchema,
  runPayloadSchema,
  runResultSchema,
  setCellValuePayloadSchema,
  setEvaluatorMappingPayloadSchema,
  setMappingPayloadSchema,
  setTargetPromptPayloadSchema,
  setTargetPromptResultSchema,
  updateTargetModelPayloadSchema,
  updateTargetModelResultSchema,
} from "./schemas";
import {
  type AnyTransform,
  addColumn,
  addEvaluator,
  addRows,
  addTarget,
  duplicateTarget,
  removeTarget,
  setCellValue,
  setEvaluatorMapping,
  setTargetMapping,
  setTargetPrompt,
  updateTargetModel,
} from "./transforms";

/**
 * Every action the evaluations workbench exposes, in one table.
 *
 * Imported by the browser store and by the server executor, so it stays free of
 * anything either side cannot load: zod schemas, the pure transforms, and
 * types. No React, no zustand, no Prisma, no tRPC.
 *
 * `backend` says who carries the action out:
 * - "transform": the pure state transform named in `transform`.
 * - "read": answered from state, nothing is written.
 * - "run": handed to the execution pipeline.
 */
export type WorkbenchActionBackend = "transform" | "read" | "run";

export type WorkbenchActionDefinition = {
  payloadSchema: z.ZodTypeAny;
  resultSchema?: z.ZodTypeAny;
  requiredPermission: AuthzPermission;
  /**
   * Wall-clock budget for one execution. Transforms are pure state edits and
   * finish in microseconds; a run is bounded by the evaluation pipeline.
   */
  executeBudgetMs?: number;
  backend: WorkbenchActionBackend;
  transform?: AnyTransform;
};

/**
 * Writes gate on `experiments:update` — the workbench state is the experiment's
 * saved document. Reading gates on `experiments:view`. Starting a run gates on
 * `evaluations:create`, the same grain the experiments-v3 run route requires,
 * because a run spends provider budget rather than editing a document.
 */
export const WORKBENCH_ACTIONS = {
  "workbench.duplicateTarget": {
    payloadSchema: duplicateTargetPayloadSchema,
    resultSchema: duplicateTargetResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 1_000,
    backend: "transform",
    transform: duplicateTarget,
  },
  "workbench.setTargetPrompt": {
    payloadSchema: setTargetPromptPayloadSchema,
    resultSchema: setTargetPromptResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 1_000,
    backend: "transform",
    transform: setTargetPrompt,
  },
  "workbench.updateTargetModel": {
    payloadSchema: updateTargetModelPayloadSchema,
    resultSchema: updateTargetModelResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 1_000,
    backend: "transform",
    transform: updateTargetModel,
  },
  "workbench.setMapping": {
    payloadSchema: setMappingPayloadSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 1_000,
    backend: "transform",
    transform: setTargetMapping,
  },
  "workbench.setEvaluatorMapping": {
    payloadSchema: setEvaluatorMappingPayloadSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 1_000,
    backend: "transform",
    transform: setEvaluatorMapping,
  },
  "workbench.addEvaluator": {
    payloadSchema: addEvaluatorPayloadSchema,
    resultSchema: addEvaluatorResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 1_000,
    backend: "transform",
    transform: addEvaluator,
  },
  "workbench.addTarget": {
    payloadSchema: addTargetPayloadSchema,
    resultSchema: addTargetResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 1_000,
    backend: "transform",
    transform: addTarget,
  },
  "workbench.setCellValue": {
    payloadSchema: setCellValuePayloadSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 1_000,
    backend: "transform",
    transform: setCellValue,
  },
  "workbench.addColumn": {
    payloadSchema: addColumnPayloadSchema,
    resultSchema: addColumnResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 1_000,
    backend: "transform",
    transform: addColumn,
  },
  "workbench.addRows": {
    payloadSchema: addRowsPayloadSchema,
    resultSchema: addRowsResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 1_000,
    backend: "transform",
    transform: addRows,
  },
  "workbench.removeTarget": {
    payloadSchema: removeTargetPayloadSchema,
    resultSchema: removeTargetResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 1_000,
    backend: "transform",
    transform: removeTarget,
  },
  "workbench.getState": {
    payloadSchema: getStatePayloadSchema,
    requiredPermission: "experiments:view",
    executeBudgetMs: 1_000,
    backend: "read",
  },
  "workbench.run": {
    payloadSchema: runPayloadSchema,
    resultSchema: runResultSchema,
    requiredPermission: "evaluations:create",
    executeBudgetMs: 600_000,
    backend: "run",
  },
} as const satisfies Record<string, WorkbenchActionDefinition>;

export type WorkbenchActionKind = keyof typeof WORKBENCH_ACTIONS;

export const WORKBENCH_ACTION_KINDS = Object.keys(
  WORKBENCH_ACTIONS,
) as WorkbenchActionKind[];

export const isWorkbenchActionKind = (
  kind: string,
): kind is WorkbenchActionKind => kind in WORKBENCH_ACTIONS;

/** The parsed payload type for one action kind. */
export type WorkbenchActionPayload<Kind extends WorkbenchActionKind> = z.infer<
  (typeof WORKBENCH_ACTIONS)[Kind]["payloadSchema"]
>;

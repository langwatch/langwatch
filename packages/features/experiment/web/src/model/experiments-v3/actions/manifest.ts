import type { AuthzPermission } from "@langwatch/authz-contract";
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
} from "./transforms/index";

/**
 * Every action the evaluations workbench exposes, in one table.
 */
export type WorkbenchActionBackend = "transform" | "read" | "run";

export type WorkbenchActionDefinition = {
  payloadSchema: z.ZodTypeAny;
  resultSchema?: z.ZodTypeAny;
  requiredPermission: AuthzPermission;
  /**
   * Wall-clock budget for one execution, claim window included.
   */
  executeBudgetMs?: number;
  backend: WorkbenchActionBackend;
  transform?: AnyTransform;
};

/**
 * Writes gate on `experiments:update` — the workbench state is the experiment's saved
 * document. Reading gates on `experiments:view`.
 */
export const WORKBENCH_ACTIONS = {
  "workbench.duplicateTarget": {
    payloadSchema: duplicateTargetPayloadSchema,
    resultSchema: duplicateTargetResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 12_000,
    backend: "transform",
    transform: duplicateTarget,
  },
  "workbench.setTargetPrompt": {
    payloadSchema: setTargetPromptPayloadSchema,
    resultSchema: setTargetPromptResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 12_000,
    backend: "transform",
    transform: setTargetPrompt,
  },
  "workbench.updateTargetModel": {
    payloadSchema: updateTargetModelPayloadSchema,
    resultSchema: updateTargetModelResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 12_000,
    backend: "transform",
    transform: updateTargetModel,
  },
  "workbench.setMapping": {
    payloadSchema: setMappingPayloadSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 12_000,
    backend: "transform",
    transform: setTargetMapping,
  },
  "workbench.setEvaluatorMapping": {
    payloadSchema: setEvaluatorMappingPayloadSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 12_000,
    backend: "transform",
    transform: setEvaluatorMapping,
  },
  "workbench.addEvaluator": {
    payloadSchema: addEvaluatorPayloadSchema,
    resultSchema: addEvaluatorResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 12_000,
    backend: "transform",
    transform: addEvaluator,
  },
  "workbench.addTarget": {
    payloadSchema: addTargetPayloadSchema,
    resultSchema: addTargetResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 12_000,
    backend: "transform",
    transform: addTarget,
  },
  "workbench.setCellValue": {
    payloadSchema: setCellValuePayloadSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 12_000,
    backend: "transform",
    transform: setCellValue,
  },
  "workbench.addColumn": {
    payloadSchema: addColumnPayloadSchema,
    resultSchema: addColumnResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 12_000,
    backend: "transform",
    transform: addColumn,
  },
  "workbench.addRows": {
    payloadSchema: addRowsPayloadSchema,
    resultSchema: addRowsResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 12_000,
    backend: "transform",
    transform: addRows,
  },
  "workbench.removeTarget": {
    payloadSchema: removeTargetPayloadSchema,
    resultSchema: removeTargetResultSchema,
    requiredPermission: "experiments:update",
    executeBudgetMs: 12_000,
    backend: "transform",
    transform: removeTarget,
  },
  "workbench.getState": {
    payloadSchema: getStatePayloadSchema,
    requiredPermission: "experiments:view",
    executeBudgetMs: 12_000,
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

export const WORKBENCH_ACTION_KINDS = Object.keys(WORKBENCH_ACTIONS) as WorkbenchActionKind[];

/**
 * Own properties only: `kind` arrives from the wire, and `in` would accept
 * `constructor` or `toString` through `Object.prototype` and hand the executor
 * a kind with no action definition behind it.
 */
export const isWorkbenchActionKind = (kind: string): kind is WorkbenchActionKind =>
  Object.hasOwn(WORKBENCH_ACTIONS, kind);

/** The parsed payload type for one action kind. */
export type WorkbenchActionPayload<Kind extends WorkbenchActionKind> = z.infer<
  (typeof WORKBENCH_ACTIONS)[Kind]["payloadSchema"]
>;

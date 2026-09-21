import type { AuthzPermission } from "@langwatch/authz-contract";
import type { z } from "zod";

import {
  getStatePayloadSchema,
  runInstantEvalPayloadSchema,
  runInstantEvalResultSchema,
  selectPayloadSchema,
  selectResultSchema,
  setFilterPayloadSchema,
  setFilterResultSchema,
  setLensPayloadSchema,
  setLensResultSchema,
  setPagePayloadSchema,
  setSortPayloadSchema,
  setTimeRangePayloadSchema,
  setTimeRangeResultSchema,
} from "./schemas.ts";
import { setFilter } from "./transforms/query.ts";
import { select } from "./transforms/rows.ts";
import { setTimeRange } from "./transforms/time-range.ts";
import type { AnyExplorerTransform } from "./transforms/types.ts";
import { setLens, setPage, setSort } from "./transforms/view.ts";

/**
 * Every action the Trace Explorer exposes to an agent, in one table: zod
 * schemas, pure transforms and types only, so the page and the server executor
 * can both read it. @see specs/langy/langy-trace-explorer-actions.feature
 */
export type ExplorerActionBackend = "transform" | "read" | "run";
export type ExplorerActionAway = "link" | "saved" | "none";

export type ExplorerActionDefinition = {
  payloadSchema: z.ZodTypeAny;
  resultSchema?: z.ZodTypeAny;
  requiredPermission: AuthzPermission;
  /** Wall-clock budget for one execution, claim window included. */
  executeBudgetMs?: number;
  backend: ExplorerActionBackend;
  explorerTransform?: AnyExplorerTransform;
  away: ExplorerActionAway;
};

/**
 * Changing what the Explorer shows is reading traces a different way, so it
 * gates on `traces:view`. Starting an Instant Eval spends the organisation's
 * budget, so it gates on `analytics:manage`.
 */
export const EXPLORER_ACTIONS = {
  "explorer.setFilter": {
    payloadSchema: setFilterPayloadSchema,
    resultSchema: setFilterResultSchema,
    requiredPermission: "traces:view",
    executeBudgetMs: 8_000,
    backend: "transform",
    explorerTransform: setFilter,
    away: "link",
  },
  "explorer.setTimeRange": {
    payloadSchema: setTimeRangePayloadSchema,
    resultSchema: setTimeRangeResultSchema,
    requiredPermission: "traces:view",
    executeBudgetMs: 8_000,
    backend: "transform",
    explorerTransform: setTimeRange,
    away: "link",
  },
  "explorer.setLens": {
    payloadSchema: setLensPayloadSchema,
    resultSchema: setLensResultSchema,
    requiredPermission: "traces:view",
    executeBudgetMs: 8_000,
    backend: "transform",
    explorerTransform: setLens,
    away: "link",
  },
  "explorer.setSort": {
    payloadSchema: setSortPayloadSchema,
    requiredPermission: "traces:view",
    executeBudgetMs: 8_000,
    backend: "transform",
    explorerTransform: setSort,
    away: "none",
  },
  "explorer.setPage": {
    payloadSchema: setPagePayloadSchema,
    requiredPermission: "traces:view",
    executeBudgetMs: 8_000,
    backend: "transform",
    explorerTransform: setPage,
    away: "none",
  },
  "explorer.select": {
    payloadSchema: selectPayloadSchema,
    resultSchema: selectResultSchema,
    requiredPermission: "traces:view",
    executeBudgetMs: 8_000,
    backend: "transform",
    explorerTransform: select,
    away: "none",
  },
  "explorer.getState": {
    payloadSchema: getStatePayloadSchema,
    requiredPermission: "traces:view",
    executeBudgetMs: 8_000,
    backend: "read",
    away: "saved",
  },
  "explorer.runInstantEval": {
    payloadSchema: runInstantEvalPayloadSchema,
    resultSchema: runInstantEvalResultSchema,
    requiredPermission: "analytics:manage",
    executeBudgetMs: 8_000,
    backend: "run",
    away: "none",
  },
} as const satisfies Record<string, ExplorerActionDefinition>;

export type ExplorerActionKind = keyof typeof EXPLORER_ACTIONS;

export const EXPLORER_ACTION_KINDS = Object.keys(EXPLORER_ACTIONS) as ExplorerActionKind[];

/**
 * Own properties only: `kind` arrives from the wire, and `in` would accept
 * `constructor` or `toString` through `Object.prototype` and hand the executor
 * a kind with no action definition behind it.
 */
export const isExplorerActionKind = (kind: string): kind is ExplorerActionKind =>
  Object.hasOwn(EXPLORER_ACTIONS, kind);

/** The parsed payload type for one action kind. */
export type ExplorerActionPayload<Kind extends ExplorerActionKind> = z.infer<
  (typeof EXPLORER_ACTIONS)[Kind]["payloadSchema"]
>;

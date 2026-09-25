import type { AuthzPermission } from "@langwatch/authz";
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
} from "./schemas";
import { setFilter } from "./transforms/query";
import { select } from "./transforms/rows";
import { setTimeRange } from "./transforms/timeRange";
import type { AnyExplorerTransform } from "./transforms/types";
import { setLens, setPage, setSort } from "./transforms/view";

/**
 * Every action the Trace Explorer exposes to an agent, in one table.
 *
 * Imported by the page and by the server executor, so it stays free of
 * anything either side cannot load: zod schemas, the pure transforms, and
 * types. No React, no zustand, no tRPC.
 *
 * `backend` says who carries the action out on an open page:
 * - "transform": the pure state transform named in `explorerTransform`.
 * - "read": answered from state, nothing is written.
 * - "run": handed to the Explorer's Instant Eval route.
 *
 * `away` says what the action answers when no Explorer is open:
 * - "link": the transform runs over the Explorer's defaults and the answer is
 *   a link that opens the Explorer in that state.
 * - "saved": the defaults themselves, marked as not read from a page.
 * - "none": the action only means something on an open page, so the dispatch
 *   is refused for lack of a browser.
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
 * gates on `traces:view`, the grain the page itself needs. Starting an Instant
 * Eval spends the organisation's budget, so it gates on `analytics:manage`,
 * the same grain the Instant Evals API requires to start a run.
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

export const EXPLORER_ACTION_KINDS = Object.keys(
  EXPLORER_ACTIONS,
) as ExplorerActionKind[];

/**
 * Own properties only: `kind` arrives from the wire, and `in` would accept
 * `constructor` or `toString` through `Object.prototype` and hand the executor
 * a kind with no action definition behind it.
 */
export const isExplorerActionKind = (
  kind: string,
): kind is ExplorerActionKind => Object.hasOwn(EXPLORER_ACTIONS, kind);

/** The parsed payload type for one action kind. */
export type ExplorerActionPayload<Kind extends ExplorerActionKind> = z.infer<
  (typeof EXPLORER_ACTIONS)[Kind]["payloadSchema"]
>;

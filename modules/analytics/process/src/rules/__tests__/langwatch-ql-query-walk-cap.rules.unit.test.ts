/**
 * A table refused once the violation list is full records nothing: no violation, and no
 * refused-view entry for the caller-access check to match against.
 * @see specs/lwql/query-origin.feature
 * @vitest-environment node
 */
import type { LangWatchQLViolation } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LWQL_LIMITS,
  type ResolvedLangWatchQLPolicy,
} from "../langwatch-ql-policy.rules.ts";
import { report, ROOT_FRAME, visitTableIdentifier } from "../langwatch-ql-query-walk.rules.ts";
import { MAX_VIOLATIONS, type WalkContext } from "../langwatch-ql-validation-shape.rules.ts";

const filler = (): LangWatchQLViolation => ({
  code: "TABLE_NOT_ALLOWED",
  clause: "projection",
  message: "filler",
  hint: "filler",
});

const policy: ResolvedLangWatchQLPolicy = {
  allowedTables: new Set(["analytics.traces"]),
  gatedColumns: new Set(),
  heldPermissions: new Set(),
  isInstantEvalsEnabled: false,
  reservedDatabases: new Set(["system"]),
  defaultDatabase: "analytics",
  limits: DEFAULT_LWQL_LIMITS,
  availableViews: ["analytics.traces"],
  viewColumns: new Map(),
  gatedColumnGates: new Map(),
};

const walkContext = (violations: LangWatchQLViolation[]): WalkContext => ({
  policy,
  violations,
  tables: [],
  parameters: [],
  blocks: [],
  appFunctions: [],
  topLevelLimits: [],
  refusedViews: [],
});

describe("report at the violation cap", () => {
  const refusal = { code: "TABLE_NOT_ALLOWED", message: "x" } as const;

  it("returns the capped outcome and pushes nothing once the cap is reached", () => {
    const ctx = walkContext(Array.from({ length: MAX_VIOLATIONS }, filler));

    const result = report({ ctx, frame: ROOT_FRAME, ...refusal });

    expect(result).toEqual({ outcome: "capped" });
    expect(ctx.violations).toHaveLength(MAX_VIOLATIONS);
  });

  it("returns the reported outcome with the pushed violation one below the cap", () => {
    const ctx = walkContext(Array.from({ length: MAX_VIOLATIONS - 1 }, filler));

    const result = report({ ctx, frame: ROOT_FRAME, ...refusal });

    expect(result).toEqual({ outcome: "reported", violation: ctx.violations[MAX_VIOLATIONS - 1] });
    expect(ctx.violations).toHaveLength(MAX_VIOLATIONS);
  });
});

describe("visitTableIdentifier at the violation cap", () => {
  const disallowed = { type: "TableIdentifier", name: "hidden_view" };

  it("records neither a violation nor a refused view once the cap is reached", () => {
    const ctx = walkContext(Array.from({ length: MAX_VIOLATIONS }, filler));

    const frame = visitTableIdentifier({ node: disallowed, frame: ROOT_FRAME, ctx });

    expect(frame).toBeNull();
    expect(ctx.violations).toHaveLength(MAX_VIOLATIONS);
    expect(ctx.refusedViews).toEqual([]);
  });

  it("records the violation and the refused view one below the cap", () => {
    const ctx = walkContext(Array.from({ length: MAX_VIOLATIONS - 1 }, filler));

    visitTableIdentifier({ node: disallowed, frame: ROOT_FRAME, ctx });

    expect(ctx.violations).toHaveLength(MAX_VIOLATIONS);
    expect(ctx.refusedViews).toEqual([
      { violation: ctx.violations[MAX_VIOLATIONS - 1], table: "analytics.hidden_view" },
    ]);
  });
});

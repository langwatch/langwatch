/**
 * The Explorer's action table: what exists, what each needs, and what the
 * schema refuses before anything reaches the page.
 *
 * Spec: specs/langy/langy-trace-explorer-actions.feature ("The Explorer's
 * actions are typed, permissioned and advertised").
 */
import { describe, expect, it } from "vitest";
import {
  EXPLORER_ACTION_KINDS,
  EXPLORER_ACTIONS,
  type ExplorerActionKind,
  isExplorerActionKind,
} from "../manifest";

const entries = Object.entries(EXPLORER_ACTIONS) as [
  ExplorerActionKind,
  (typeof EXPLORER_ACTIONS)[ExplorerActionKind],
][];

describe("given the explorer action manifest", () => {
  it("lists every action the Explorer exposes", () => {
    expect(EXPLORER_ACTION_KINDS).toEqual([
      "explorer.setFilter",
      "explorer.setTimeRange",
      "explorer.setLens",
      "explorer.setSort",
      "explorer.setPage",
      "explorer.select",
      "explorer.getState",
      "explorer.runInstantEval",
    ]);
  });

  /** @scenario "Every explorer action names its payload schema and permission" */
  it("gives every action a payload schema, and traces:view to every view change", () => {
    for (const [kind, definition] of entries) {
      expect(typeof definition.payloadSchema.safeParse, kind).toBe("function");
      if (kind !== "explorer.runInstantEval") {
        expect(definition.requiredPermission, kind).toBe("traces:view");
      }
    }
  });

  /** @scenario "Running an Instant Eval from Langy needs analytics:manage" */
  it("gates the Instant Eval on analytics:manage", () => {
    expect(EXPLORER_ACTIONS["explorer.runInstantEval"].requiredPermission).toBe(
      "analytics:manage",
    );
  });

  it("names the transform behind every transform action", () => {
    for (const [kind, definition] of entries) {
      if (definition.backend !== "transform") continue;
      expect(
        typeof (definition as { explorerTransform?: unknown })
          .explorerTransform,
        kind,
      ).toBe("function");
    }
  });

  it("describes every payload, since the listing is the only documentation", () => {
    for (const [kind, definition] of entries) {
      expect(definition.payloadSchema.description, kind).toBeTruthy();
    }
  });

  it("takes only its own kinds", () => {
    expect(isExplorerActionKind("explorer.setFilter")).toBe(true);
    expect(isExplorerActionKind("constructor")).toBe(false);
    expect(isExplorerActionKind("workbench.getState")).toBe(false);
  });
});

describe("given a payload", () => {
  describe("when explorer.setTimeRange is given neither a preset nor a window", () => {
    /** @scenario "An explorer payload the schema refuses never reaches the page" */
    it("is refused by the schema", () => {
      const schema = EXPLORER_ACTIONS["explorer.setTimeRange"].payloadSchema;
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ from: 1 }).success).toBe(false);
      expect(schema.safeParse({ preset: "7d" }).success).toBe(true);
      expect(schema.safeParse({ from: 1, to: 2 }).success).toBe(true);
    });
  });

  describe("when explorer.setFilter is given only a query", () => {
    it("defaults to replacing the search", () => {
      const parsed = EXPLORER_ACTIONS["explorer.setFilter"].payloadSchema.parse(
        { query: "status:error" },
      );
      expect(parsed).toEqual({ query: "status:error", mode: "replace" });
    });
  });

  describe("when explorer.runInstantEval is given one criterion", () => {
    it("is refused, because a judge needs what counts as yes and as no", () => {
      const schema = EXPLORER_ACTIONS["explorer.runInstantEval"].payloadSchema;
      expect(
        schema.safeParse({ instructions: "Annoyed?", criteria: ["yes"] })
          .success,
      ).toBe(false);
    });
  });
});

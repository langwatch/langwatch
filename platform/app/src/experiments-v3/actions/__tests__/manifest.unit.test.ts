import { describe, expect, it } from "vitest";
import {
  isWorkbenchActionKind,
  WORKBENCH_ACTION_KINDS,
  WORKBENCH_ACTIONS,
  type WorkbenchActionKind,
} from "../manifest";

const entries = Object.entries(WORKBENCH_ACTIONS) as [
  WorkbenchActionKind,
  (typeof WORKBENCH_ACTIONS)[WorkbenchActionKind],
][];

describe("given the workbench action manifest", () => {
  it("lists every action the workbench exposes", () => {
    expect(WORKBENCH_ACTION_KINDS).toEqual([
      "workbench.duplicateTarget",
      "workbench.setTargetPrompt",
      "workbench.updateTargetModel",
      "workbench.setMapping",
      "workbench.setEvaluatorMapping",
      "workbench.addEvaluator",
      "workbench.addTarget",
      "workbench.setCellValue",
      "workbench.addColumn",
      "workbench.addRows",
      "workbench.removeTarget",
      "workbench.getState",
      "workbench.run",
    ]);
  });

  /** @scenario "Every action names the permission it needs" */
  it.each(
    entries,
  )("%s has a payload schema and a permission", (_kind, definition) => {
    expect(typeof definition.payloadSchema.safeParse).toBe("function");
    expect(definition.requiredPermission).toMatch(/^[a-zA-Z]+:[a-z]+$/);
  });

  it.each(entries)("%s names a backend", (_kind, definition) => {
    expect(["transform", "read", "run"]).toContain(definition.backend);
  });

  describe("when the backend is a transform", () => {
    it("names the transform function", () => {
      const transformBacked = entries.filter(
        ([, definition]) => definition.backend === "transform",
      );

      expect(transformBacked.length).toBeGreaterThan(0);
      for (const [kind, definition] of transformBacked) {
        expect(
          typeof (definition as { transform?: unknown }).transform,
          `${kind} has no transform`,
        ).toBe("function");
      }
    });
  });

  describe("when the backend is not a transform", () => {
    it("names no transform", () => {
      for (const [kind, definition] of entries) {
        if (definition.backend === "transform") continue;
        expect(
          (definition as { transform?: unknown }).transform,
          `${kind} must not carry a transform`,
        ).toBeUndefined();
      }
    });
  });

  it("gates writes on experiments:update, reads on experiments:view and runs on evaluations:create", () => {
    for (const [, definition] of entries) {
      const expected =
        definition.backend === "read"
          ? "experiments:view"
          : definition.backend === "run"
            ? "evaluations:create"
            : "experiments:update";
      expect(definition.requiredPermission).toBe(expected);
    }
  });

  it("gives every action an execute budget", () => {
    for (const [, definition] of entries) {
      expect(definition.executeBudgetMs).toBeGreaterThan(0);
    }
  });

  describe("when a caller checks a kind against the manifest", () => {
    it("accepts a listed kind and rejects anything else", () => {
      expect(isWorkbenchActionKind("workbench.addTarget")).toBe(true);
      expect(isWorkbenchActionKind("workbench.deleteEverything")).toBe(false);
    });

    it("rejects a key inherited from Object.prototype", () => {
      for (const inherited of [
        "constructor",
        "toString",
        "hasOwnProperty",
        "__proto__",
        "valueOf",
      ]) {
        expect(isWorkbenchActionKind(inherited), inherited).toBe(false);
      }
    });
  });
});

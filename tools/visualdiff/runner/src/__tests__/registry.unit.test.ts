import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REGISTRY, resolveAction } from "../flows/registry";

/**
 * The Go side refuses a step naming an action this package does not implement,
 * which is worth something only while the two lists agree — so this reads the
 * Go source rather than restating it.
 */
const goActions = (): string[] => {
  const source = readFileSync(join(import.meta.dirname, "..", "..", "..", "config.go"), "utf8");
  const block = /var RunnerActions = \[\]string\{([^}]*)\}/.exec(source);
  if (block === null) throw new Error("RunnerActions not found in tools/visualdiff/config.go");
  return [...(block[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1] as string);
};

describe("Feature: Visual diff between two refs", () => {
  describe("given a flow step naming an action the runner does not implement", () => {
    describe("when the configuration is loaded", () => {
      /** @scenario An unknown action in visualdiff.yaml is refused before anything boots */
      it("refuses the unknown action by name", () => {
        expect(() => resolveAction("teleport")).toThrowError(/unknown action "teleport"/);
      });

      /** @scenario An unknown action in visualdiff.yaml is refused before anything boots */
      it("implements every action the Go side accepts, and no more", () => {
        expect(Object.keys(REGISTRY).sort()).toEqual(goActions().sort());
      });
    });
  });
});

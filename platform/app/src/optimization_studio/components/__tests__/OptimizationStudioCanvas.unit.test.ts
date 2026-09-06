import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

describe("OptimizationStudioCanvas", () => {
  describe("when configuring ReactFlow", () => {
    it("sets selectNodesOnDrag to false to prevent drawer opening on drag", () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, "../OptimizationStudio.tsx"),
        "utf-8",
      );

      expect(source).toContain("selectNodesOnDrag={false}");
    });

    /** @scenario "Removing a selected connection with the Delete key" */
    /** @scenario "Removing a selected connection with the Backspace key" */
    /** @scenario "Removing a selected node with the Delete key" */
    it("binds both Backspace and Delete so nodes and connections delete with either key", () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, "../OptimizationStudio.tsx"),
        "utf-8",
      );

      // ReactFlow defaults deleteKeyCode to "Backspace" only, so the Delete
      // key alone would not remove a selected node or connection. Bind both.
      expect(source).toMatch(
        /deleteKeyCode=\{\[\s*["']Backspace["']\s*,\s*["']Delete["']\s*\]\}/,
      );
    });
  });
});

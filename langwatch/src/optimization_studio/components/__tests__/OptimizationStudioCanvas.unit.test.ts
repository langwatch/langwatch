import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("OptimizationStudioCanvas", () => {
  describe("when configuring ReactFlow", () => {
    it("sets selectNodesOnDrag to false to prevent drawer opening on drag", () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, "../OptimizationStudio.tsx"),
        "utf-8"
      );

      expect(source).toContain("selectNodesOnDrag={false}");
    });
  });
});

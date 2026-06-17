/**
 * Unit tests for the shared code-signature rewriter used by the studio code
 * node and the custom code-evaluator drawer.
 * See specs/workflows/code-node-input-sync.feature.
 */
import { describe, expect, it } from "vitest";

import { rewriteCodeSignature } from "../codeSignature";

describe("rewriteCodeSignature", () => {
  describe("given inputs to sync", () => {
    describe("when the entrypoint is __call__", () => {
      it("rewrites the parameter list with None defaults", () => {
        const code = "class Code:\n  def __call__(self, output: str):\n    return {}";
        const next = rewriteCodeSignature(code, [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ]);
        expect(next).toContain(
          "def __call__(self, output: str = None, expected_output: str = None):",
        );
      });

      it("maps studio field types to python annotations", () => {
        const next = rewriteCodeSignature("def __call__(self):\n  pass", [
          { identifier: "count", type: "int" },
          { identifier: "ratio", type: "float" },
          { identifier: "ok", type: "bool" },
        ]);
        expect(next).toContain(
          "def __call__(self, count: int = None, ratio: float = None, ok: bool = None):",
        );
      });
    });

    describe("when the entrypoint is the legacy forward", () => {
      it("preserves the method name", () => {
        const next = rewriteCodeSignature("def forward(self, x: str):\n  pass", [
          { identifier: "input", type: "str" },
        ]);
        expect(next).toContain("def forward(self, input: str = None):");
      });
    });

    describe("when the signature has a return type annotation", () => {
      it("preserves the return type while rewriting the parameters", () => {
        const next = rewriteCodeSignature(
          "def __call__(self, output: str) -> dict:\n  return {}",
          [{ identifier: "output", type: "str" }],
        );
        expect(next).toContain(
          "def __call__(self, output: str = None) -> dict:",
        );
      });
    });

    describe("when a field has no concrete python type", () => {
      it("falls back to Any and imports it once", () => {
        const next = rewriteCodeSignature("def __call__(self):\n  pass", [
          { identifier: "schema", type: "json_schema" },
        ]);
        expect(next).toContain("def __call__(self, schema: Any = None):");
        expect(next).toContain("from typing import Any");
        expect(next.match(/from typing import Any/g)).toHaveLength(1);
      });
    });
  });

  describe("given no inputs", () => {
    describe("when rewriting", () => {
      it("returns the code unchanged", () => {
        const code = "def __call__(self, output: str):\n  return {}";
        expect(rewriteCodeSignature(code, [])).toBe(code);
      });
    });
  });
});

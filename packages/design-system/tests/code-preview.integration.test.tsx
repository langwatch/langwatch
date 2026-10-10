// @vitest-environment jsdom

import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CodePreview } from "../src/components/display/code-preview.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("CodePreview", () => {
  describe("given a snippet", () => {
    it("shows the filename in a window with a copy button and a Shiki-highlighted body", async () => {
      const { container } = renderWithDesignSystem(
        <CodePreview code="const a = 1;" language="typescript" filename="app.ts" />,
      );

      expect(screen.getByText("app.ts")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
      await waitFor(() => expect(container.querySelector("pre.shiki")).not.toBeNull());
    });
  });

  describe("given empty code", () => {
    it("renders nothing", () => {
      const { container } = renderWithDesignSystem(<CodePreview code="" language="bash" />);
      expect(container.querySelector("pre")).toBeNull();
    });
  });

  describe("given a diff with line numbers", () => {
    /** @scenario "A diff draws a marker column beside highlighted code" */
    it("tags each line with its kind and a gutter, and the code loses its markers", async () => {
      const { container } = renderWithDesignSystem(
        <CodePreview
          code={"@@ -1,2 +1,2 @@\n keep\n-old\n+new"}
          language="python"
          diff
          lineNumbers
        />,
      );

      await waitFor(() => expect(container.querySelector("pre.shiki")).not.toBeNull());
      const lines = [...container.querySelectorAll(".line")];
      expect(lines.map((line) => line.getAttribute("data-diff"))).toEqual([
        "hunk",
        "context",
        "remove",
        "add",
      ]);
      expect(lines.map((line) => line.getAttribute("data-gutter"))).toEqual([
        "      ",
        "1 1   ",
        "2   - ",
        "  2 + ",
      ]);
      expect(lines[2]?.textContent).toBe("old");
    });
  });
});

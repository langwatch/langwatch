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
});

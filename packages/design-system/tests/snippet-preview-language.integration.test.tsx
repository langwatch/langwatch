// @vitest-environment jsdom

import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SnippetPreview } from "../src/components/display/code-preview.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

const GO = 'package main\n\nfunc main() { println("hi") }';
const PY = 'print("hi")';

function Preview({ language }: { language: string }) {
  return (
    <SnippetPreview code={language === "go" ? GO : PY} filename="snippet" codeLanguage={language} />
  );
}

describe("SnippetPreview language readiness", () => {
  describe("given the same instance switching from eager Python to a cold Go grammar", () => {
    /** @scenario "A snippet switching to a grammar not yet loaded shows readable code first" */
    it("renders readable code at once, then highlighted Go, without throwing", async () => {
      const { container, rerender } = renderWithDesignSystem(<Preview language="python" />);
      await waitFor(() => expect(container.querySelector(".line span[style]")).not.toBeNull(), {
        timeout: 25000,
      });

      rerender(<Preview language="go" />);

      expect(container.textContent).toContain("package main");
      await waitFor(() => expect(container.querySelector(".line span[style]")).not.toBeNull(), {
        timeout: 25000,
      });
      expect(container.textContent).toContain("func main()");
    }, 30000);
  });

  describe("given an unknown language", () => {
    it("shows the code as plain text", async () => {
      const { container } = renderWithDesignSystem(
        <SnippetPreview code="hello" filename="x" codeLanguage="no-such-language" />,
      );
      await waitFor(() => expect(screen.getAllByText(/hello/).length).toBeGreaterThan(0));
      expect(container.textContent).toContain("hello");
    });
  });

  describe("given rapid switches and an unmount mid-load", () => {
    it("settles on the last language and does not throw after unmount", async () => {
      const { container, rerender, unmount } = renderWithDesignSystem(
        <Preview language="python" />,
      );
      rerender(<Preview language="go" />);
      rerender(<Preview language="python" />);
      rerender(<Preview language="go" />);
      await waitFor(() => expect(container.querySelector(".line span[style]")).not.toBeNull(), {
        timeout: 25000,
      });
      unmount();
    }, 30000);
  });
});

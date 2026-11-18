/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { SnippetPreview } from "../code-preview.tsx";

// Shiki is loaded lazily by the shared adapter; the real wasm highlighter is
// unnecessary for structural assertions.
vi.mock("shiki", () => {
  const highlighter = {
    codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
    getLoadedLanguages: () => ["bash", "shellscript"],
    loadLanguage: () => Promise.resolve(),
  };
  return {
    bundledLanguagesInfo: [],
    createHighlighter: () => Promise.resolve(highlighter),
    getSingletonHighlighter: () => Promise.resolve(highlighter),
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function copyOnce() {
  const copy = vi.fn().mockResolvedValue(true);
  const { unmount } = renderWithDesignSystem(
    <SnippetPreview code="npm i langwatch" filename="Install" codeLanguage="bash" copy={copy} />,
  );
  const button = screen.getByRole("button", { name: "Copy install" });
  fireEvent.click(button);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return { button, unmount };
}

describe("Feature: Code, money and dates read the one way", () => {
  /** @scenario "A snippet copy button that unmounts does not reset after it is gone" */
  it("Scenario: A snippet copy button that unmounts does not reset after it is gone", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = await copyOnce();

    unmount();
    // Checked before advancing: an uncleared timer would have fired by 2000 ms.
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(errors).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  /** @scenario "A snippet copy button returns to its copy icon after 2 seconds" */
  it("Scenario: A snippet copy button returns to the copy icon after 2 seconds", async () => {
    vi.useFakeTimers();
    const { button } = await copyOnce();
    expect(button.querySelector("svg.lucide-check")).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(button.querySelector("svg.lucide-check")).toBeNull();
    expect(button.querySelector("svg.lucide-clipboard")).not.toBeNull();
  });

  /** @scenario "A snippet copy button that unmounts mid-copy starts no reset timer when the copy lands" */
  it("Scenario: A snippet copy button that unmounts mid-copy starts no reset timer when the copy lands", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let resolveCopy: (ok: boolean) => void = () => undefined;
    const copy = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    const { unmount } = renderWithDesignSystem(
      <SnippetPreview code="npm i langwatch" filename="Install" codeLanguage="bash" copy={copy} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy install" }));

    unmount();
    await act(async () => {
      resolveCopy(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });
});

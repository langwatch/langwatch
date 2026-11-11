/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { SnippetPreview } from "../code-preview.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Feature: The snippet copy confirmation resets on a timer", () => {
  it("Scenario: Unmounting before the reset leaves no pending timer behind", async () => {
    vi.useFakeTimers();
    const copy = vi.fn(async () => true);
    const { unmount } = renderWithDesignSystem(
      <SnippetPreview code="npm i langwatch" filename="install" codeLanguage="bash" copy={copy} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy install" }));
    });
    const pendingAfterCopy = vi.getTimerCount();
    unmount();

    expect(copy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeLessThan(pendingAfterCopy);
  });
});

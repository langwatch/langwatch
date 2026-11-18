/**
 * @vitest-environment jsdom
 * @see specs/api-keys/token-created-snippets.feature
 */

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeApiKeyHost, renderWithApiKeyHost } from "../../../testing.tsx";
import { InlineCopyButton } from "../inline-copy-button.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function copyOnce() {
  const { unmount } = renderWithApiKeyHost(
    <InlineCopyButton text="sk-1" label="API key" />,
    new FakeApiKeyHost({ copySucceeds: true }),
  );
  const button = screen.getByRole("button", { name: "Copy api key" });
  fireEvent.click(button);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return { button, unmount };
}

describe("given an inline copy button", () => {
  /** @scenario "An inline copy button that unmounts does not reset after it is gone" */
  it("does not touch state when it unmounts before the 2 second reset", async () => {
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

  /** @scenario "An inline copy button returns to its copy icon after 2 seconds" */
  it("returns to the copy icon after 2 seconds while mounted", async () => {
    vi.useFakeTimers();
    const { button } = await copyOnce();
    expect(button.querySelector("svg.lucide-check")).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(button.querySelector("svg.lucide-check")).toBeNull();
    expect(button.querySelector("svg.lucide-clipboard")).not.toBeNull();
  });

  /** @scenario "An inline copy button that unmounts mid-copy starts no reset timer when the copy lands" */
  it("starts no reset timer when the copy resolves after unmount", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = new FakeApiKeyHost({ copyPending: true });
    const onCopied = vi.fn();
    const { unmount } = renderWithApiKeyHost(
      <InlineCopyButton text="sk-1" label="API key" onCopied={onCopied} />,
      host,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy api key" }));

    unmount();
    await act(async () => {
      host.settleCopy(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(errors).not.toHaveBeenCalled();
    expect(onCopied).toHaveBeenCalledTimes(1);
  });
});

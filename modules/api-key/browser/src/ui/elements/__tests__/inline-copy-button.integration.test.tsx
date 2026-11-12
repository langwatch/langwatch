/**
 * @vitest-environment jsdom
 * @see specs/api-keys/token-created-snippets.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiKeyHostProvider } from "../../../model/api-key-host.ts";
import { FakeApiKeyHost } from "../../../testing.tsx";
import { InlineCopyButton } from "../inline-copy-button.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("given a copy button whose Copied state is waiting to reset", () => {
  describe("when it unmounts before the reset fires", () => {
    /** @scenario "Unmounting a copy button before its reset leaves no pending timer" */
    it("leaves no reset timer pending", async () => {
      vi.useFakeTimers();
      const { unmount } = renderWithDesignSystem(
        <ApiKeyHostProvider value={new FakeApiKeyHost()}>
          <InlineCopyButton text="{}" label="Config" />
        </ApiKeyHostProvider>,
      );

      const baseline = vi.getTimerCount();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy config" }));
        await vi.advanceTimersByTimeAsync(0);
      });
      unmount();

      expect(vi.getTimerCount()).toBe(baseline);
    });
  });

  describe("when it unmounts while the copy is still pending", () => {
    /** @scenario "Unmounting a copy button while the copy is pending leaves no reset timer" */
    it("arms no reset timer once the copy resolves", async () => {
      let resolveCopy: (ok: boolean) => void = () => {};
      class DeferredCopyHost extends FakeApiKeyHost {
        override copyToClipboard(): Promise<boolean> {
          return new Promise((resolve) => {
            resolveCopy = resolve;
          });
        }
      }
      renderWithDesignSystem(
        <ApiKeyHostProvider value={new DeferredCopyHost()}>
          <InlineCopyButton text="{}" label="Config" />
        </ApiKeyHostProvider>,
      );

      const setSpy = vi.spyOn(globalThis, "setTimeout");
      try {
        fireEvent.click(screen.getByRole("button", { name: "Copy config" }));
        cleanup();
        await act(async () => {
          resolveCopy(true);
          await Promise.resolve();
        });

        expect(setSpy.mock.calls.filter((call) => call[1] === 2000)).toHaveLength(0);
      } finally {
        setSpy.mockRestore();
      }
    });
  });
});

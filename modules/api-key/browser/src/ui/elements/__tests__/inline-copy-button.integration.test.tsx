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
});

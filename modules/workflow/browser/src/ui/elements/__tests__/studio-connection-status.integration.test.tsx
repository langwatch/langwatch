/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONNECTED_LINGER_MS,
  CONNECTION_PENDING_GRACE_MS,
  StudioConnectionStatus,
} from "../studio-connection-status.tsx";

function statusLine() {
  return screen.getByTestId("studio-connection-status");
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("StudioConnectionStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("given the studio was connected", () => {
    /** @scenario A lost connection shows one reconnecting line */
    it("shows one reconnecting line once the drop outlasts the grace window", () => {
      const view = renderWithDesignSystem(<StudioConnectionStatus isConnected />);
      advance(CONNECTED_LINGER_MS);

      view.rerender(<StudioConnectionStatus isConnected={false} />);
      advance(CONNECTION_PENDING_GRACE_MS - 1);
      expect(statusLine().textContent).toBe("");

      advance(1);
      expect(statusLine().textContent).toBe("Reconnecting…");
      expect(statusLine().dataset.tone).toBe("pending");
    });

    /** @scenario The connected line fades once the connection is back */
    it("says connected when the connection returns, then fades", () => {
      const view = renderWithDesignSystem(<StudioConnectionStatus isConnected />);
      view.rerender(<StudioConnectionStatus isConnected={false} />);
      advance(CONNECTION_PENDING_GRACE_MS);

      view.rerender(<StudioConnectionStatus isConnected />);
      expect(statusLine().textContent).toBe("Connected");
      expect(statusLine().dataset.tone).toBe("connected");

      advance(CONNECTED_LINGER_MS);
      expect(statusLine().textContent).toBe("");
    });
  });

  describe("given the studio is connecting for the first time", () => {
    /** @scenario A short wait for the connection shows nothing */
    it("shows nothing when the connection lands inside the grace window", () => {
      const view = renderWithDesignSystem(<StudioConnectionStatus isConnected={false} />);
      advance(CONNECTION_PENDING_GRACE_MS - 1);

      view.rerender(<StudioConnectionStatus isConnected />);
      advance(CONNECTION_PENDING_GRACE_MS);
      expect(statusLine().textContent).toBe("");
    });

    it("says connecting, not reconnecting, while it waits", () => {
      renderWithDesignSystem(<StudioConnectionStatus isConnected={false} />);
      advance(CONNECTION_PENDING_GRACE_MS);
      expect(statusLine().textContent).toBe("Connecting…");
    });
  });
});

/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGitHubConnectPopup } from "../github-connect-popup.ts";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function openablePopup(): { popup: Window; frame: HTMLIFrameElement } {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const popup = frame.contentWindow;
  if (!popup) {
    throw new Error("jsdom did not create an iframe window");
  }
  vi.spyOn(window, "open").mockReturnValue(popup);
  return { popup, frame };
}

function postFromPopup(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data }));
  });
}

describe("useGitHubConnectPopup", () => {
  it("reports a blocked popup without leaving a pending request", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => useGitHubConnectPopup());

    const connected = await result.current.connect("org/one");

    expect(open).toHaveBeenCalledWith(
      "/api/github/install?mode=popup&organizationId=org%2Fone",
      "github-install",
      expect.stringContaining("width=600"),
    );
    expect(connected).toEqual({
      ok: false,
      reason: "popup-blocked",
      error: "Popup blocked. Allow popups and try again.",
    });
  });

  it("accepts a validated same-origin installation result", async () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const popup = frame.contentWindow;
    if (!popup) {
      throw new Error("jsdom did not create an iframe window");
    }

    vi.spyOn(window, "open").mockReturnValue(popup);
    const { result, unmount } = renderHook(() => useGitHubConnectPopup());
    const connected = result.current.connect("org-1");

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: "github-connected", login: "acme" },
        }),
      );
    });

    await expect(connected).resolves.toEqual({ ok: true, login: "acme" });
    unmount();
  });

  it("ignores messages from another origin", async () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const popup = frame.contentWindow;
    if (!popup) {
      throw new Error("jsdom did not create an iframe window");
    }

    vi.spyOn(window, "open").mockReturnValue(popup);
    const { result, unmount } = renderHook(() => useGitHubConnectPopup());
    const connected = result.current.connect("org-1");

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://example.invalid",
        data: { type: "github-connected", login: "attacker" },
      }),
    );

    const sentinel = Symbol("pending");
    await expect(Promise.race([connected, Promise.resolve(sentinel)])).resolves.toBe(sentinel);
    unmount();
  });

  it("reports the installation's own failure", async () => {
    openablePopup();
    const { result, unmount } = renderHook(() => useGitHubConnectPopup());
    const connected = result.current.connect("org-1");

    postFromPopup({ type: "github-error", message: "Installation refused" });

    await expect(connected).resolves.toEqual({
      ok: false,
      reason: "failed",
      error: "Installation refused",
    });
    unmount();
  });

  it("supersedes a pending attempt when connect is asked again with the popup open", async () => {
    openablePopup();
    const { result, unmount } = renderHook(() => useGitHubConnectPopup());
    const first = result.current.connect("org-1");
    const second = result.current.connect("org-1");

    await expect(first).resolves.toEqual({
      ok: false,
      reason: "failed",
      error: "Superseded by a new connect attempt",
    });
    expect(window.open).toHaveBeenCalledTimes(1);

    postFromPopup({ type: "github-connected", login: "acme" });
    await expect(second).resolves.toEqual({ ok: true, login: "acme" });
    unmount();
  });

  it("reports a cancellation once the popup is closed", async () => {
    vi.useFakeTimers();
    try {
      const { popup } = openablePopup();
      const { result, unmount } = renderHook(() => useGitHubConnectPopup());
      const connected = result.current.connect("org-1");

      Object.defineProperty(popup, "closed", { value: true, configurable: true });
      vi.advanceTimersByTime(500);

      await expect(connected).resolves.toEqual({
        ok: false,
        reason: "cancelled",
        error: "Cancelled",
      });
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

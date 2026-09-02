/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGitHubConnectPopup } from "../index";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

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
    await expect(Promise.race([connected, Promise.resolve(sentinel)])).resolves.toBe(
      sentinel,
    );
    unmount();
  });
});

// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveInbox } from "../use-live-inbox.ts";

let visibility: DocumentVisibilityState = "visible";

const setVisibility = ({ state }: { state: DocumentVisibilityState }) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

/** The sink: the list answers at once, the long poll parks until aborted. */
const fakeSink = () =>
  vi.fn(async (input: string, init?: RequestInit) => {
    if (input.startsWith("/api/messages/wait")) {
      return new Promise<Response>((_, refuse) => {
        init?.signal?.addEventListener("abort", () => refuse(new Error("aborted")));
      });
    }
    return new Response(JSON.stringify({ messages: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  });

const listCalls = ({ fetch }: { fetch: ReturnType<typeof fakeSink> }) =>
  fetch.mock.calls.filter(([input]) => input === "/api/messages").length;

const parkedWait = ({ fetch }: { fetch: ReturnType<typeof fakeSink> }) =>
  fetch.mock.calls.find(([input]) => input.startsWith("/api/messages/wait"))?.[1];

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useLiveInbox", () => {
  describe("when the tab is hidden", () => {
    /** @scenario "A console stops asking while its tab is hidden" */
    it("drops its parked wait, then reads at once when shown again", async () => {
      const fetch = fakeSink();
      vi.stubGlobal("fetch", fetch);
      renderHook(() => useLiveInbox({ onList: () => undefined }));
      await vi.waitFor(() => expect(parkedWait({ fetch })).toBeDefined());

      await act(async () => {
        setVisibility({ state: "hidden" });
      });
      expect(parkedWait({ fetch })?.signal?.aborted).toBe(true);
      const askedWhileHidden = fetch.mock.calls.length;

      await act(async () => {
        setVisibility({ state: "visible" });
      });
      await vi.waitFor(() => expect(listCalls({ fetch })).toBe(2));
      expect(askedWhileHidden).toBe(2);
      expect(fetch.mock.calls[askedWhileHidden]?.[0]).toBe("/api/messages");
    });

    it("keeps following in the background while notifications are on", async () => {
      const fetch = fakeSink();
      vi.stubGlobal("fetch", fetch);
      renderHook(() => useLiveInbox({ onList: () => undefined, inBackground: true }));
      await vi.waitFor(() => expect(parkedWait({ fetch })).toBeDefined());

      await act(async () => {
        setVisibility({ state: "hidden" });
      });
      expect(parkedWait({ fetch })?.signal?.aborted).toBe(false);
    });
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSSE } from "../fetch-sse.ts";

type Event = { type: string };

function streamResponse(chunks: string[], input: { close?: boolean } = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (input.close !== false) controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function stubFetch(response: () => Response) {
  const calls: RequestInit[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    calls.push(init);
    return response();
  });
  return calls;
}

function sse(events: Event[]): string[] {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchSSE", () => {
  describe("when the stream sends events and closes", () => {
    it("hands every event over and resolves", async () => {
      const calls = stubFetch(() => streamResponse(sse([{ type: "a" }, { type: "b" }])));
      const events: Event[] = [];

      await fetchSSE<Event>({
        endpoint: "/sse",
        payload: { run: 1 },
        headers: { "X-Test": "1" },
        onEvent: (event) => events.push(event),
      });

      expect(events).toEqual([{ type: "a" }, { type: "b" }]);
      expect(calls[0]?.method).toBe("POST");
      expect(calls[0]?.body).toBe(JSON.stringify({ run: 1 }));
    });
  });

  describe("when an event says to stop", () => {
    it("resolves without waiting for the stream to close", async () => {
      stubFetch(() => streamResponse(sse([{ type: "a" }, { type: "done" }]), { close: false }));
      const events: Event[] = [];

      await fetchSSE<Event>({
        endpoint: "/sse",
        payload: {},
        onEvent: (event) => events.push(event),
        shouldStopProcessing: (event) => event.type === "done",
      });

      expect(events).toEqual([{ type: "a" }, { type: "done" }]);
    });
  });

  describe("when the server refuses the request", () => {
    it("reports the refusal's error text to onError and resolves", async () => {
      stubFetch(() => Response.json({ error: "Not allowed" }, { status: 403 }));
      const errors: string[] = [];

      await fetchSSE<Event>({
        endpoint: "/sse",
        payload: {},
        onEvent: () => undefined,
        onError: (error) => errors.push(error.message),
      });

      expect(errors).toEqual(["Not allowed"]);
    });

    it("rejects with a server error when no onError is given", async () => {
      stubFetch(() => new Response("oops", { status: 500, statusText: "Internal Server Error" }));

      await expect(
        fetchSSE<Event>({ endpoint: "/sse", payload: {}, onEvent: () => undefined }),
      ).rejects.toThrow("Server error: 500 Internal Server Error");
    });
  });

  describe("when the stream goes quiet", () => {
    it("fails with a timeout after the wait for the next event", async () => {
      stubFetch(() => streamResponse([], { close: false }));
      const errors: Error[] = [];

      await fetchSSE<Event>({
        endpoint: "/sse",
        payload: {},
        timeout: 20,
        onEvent: () => undefined,
        onError: (error) => errors.push(error),
      });

      expect(errors.map((error) => error.message)).toEqual([
        "Connection timed out with timeout 20ms waiting for the next event",
      ]);
    });
  });

  describe("when the caller's signal is already aborted", () => {
    it("resolves without opening a request", async () => {
      const calls = stubFetch(() => streamResponse([]));
      const controller = new AbortController();
      controller.abort();

      await fetchSSE<Event>({
        endpoint: "/sse",
        payload: {},
        onEvent: () => undefined,
        signal: controller.signal,
      });

      expect(calls).toHaveLength(0);
    });
  });

  describe("when the caller aborts mid-stream", () => {
    it("resolves", async () => {
      stubFetch(() => streamResponse(sse([{ type: "a" }]), { close: false }));
      const controller = new AbortController();
      const events: Event[] = [];

      await fetchSSE<Event>({
        endpoint: "/sse",
        payload: {},
        onEvent: (event) => {
          events.push(event);
          controller.abort();
        },
        signal: controller.signal,
      });

      expect(events).toEqual([{ type: "a" }]);
    });
  });
});

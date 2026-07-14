import { describe, it, expect, vi } from "vitest";
import { ZodError, z } from "zod";

import { createService } from "../builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collectSSE(res: Response): Promise<string[]> {
  const reader = res.body?.getReader();
  if (!reader) return [];

  const decoder = new TextDecoder();
  const chunks: string[] = [];

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value) {
        chunks.push(decoder.decode(result.value, { stream: true }));
      }
    }
  } catch {
    // Stream closed
  } finally {
    reader.releaseLock();
  }

  return chunks;
}

function parseSSEEvents(
  chunks: string[],
): Array<{ event: string; data: unknown }> {
  const raw = chunks.join("");
  const events: Array<{ event: string; data: unknown }> = [];

  // Parse SSE format: "event: ...\ndata: ...\n\n"
  const blocks = raw.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        event = line.slice(7);
      } else if (line.startsWith("data: ")) {
        data = line.slice(6);
      }
    }
    if (event && data) {
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch {
        events.push({ event, data });
      }
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// SSE endpoint tests
// ---------------------------------------------------------------------------

describe("SSE endpoints", () => {
  describe("when an SSE endpoint emits typed events", () => {
    it("streams events in SSE format", async () => {
      const app = createService({ name: "test", basePath: "/api/test" })
        .version("2025-03-15", (v) => {
          v.sse(
            "/stream",
            {
              events: {
                progress: z.object({ percent: z.number() }),
                done: z.object({ total: z.number() }),
              },
            },
            async (_c, _args, stream) => {
              await stream.emit("progress", { percent: 50 });
              await stream.emit("progress", { percent: 100 });
              await stream.emit("done", { total: 2 });
              stream.close();
            },
          );
        })
        .build();

      const res = await app.request("/api/test/2025-03-15/stream");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");

      const chunks = await collectSSE(res);
      const events = parseSSEEvents(chunks);

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ event: "progress", data: { percent: 50 } });
      expect(events[1]).toEqual({ event: "progress", data: { percent: 100 } });
      expect(events[2]).toEqual({ event: "done", data: { total: 2 } });
    });
  });

  describe("when SSE event data fails schema validation", () => {
    it("emits an error event and rejects instead of silently continuing", async () => {
      const app = createService({ name: "test", basePath: "/api/test" })
        .version("2025-03-15", (v) => {
          v.sse(
            "/stream",
            {
              events: {
                result: z.object({ score: z.number() }),
              },
            },
            async (_c, _args, stream) => {
              await expect(
                stream.emit("result", {
                  score: "invalid" as unknown as number,
                }),
              ).rejects.toBeInstanceOf(ZodError);

              // Callers may explicitly recover and continue the stream.
              await stream.emit("result", { score: 0.95 });
              stream.close();
            },
          );
        })
        .build();

      const res = await app.request("/api/test/2025-03-15/stream");
      expect(res.status).toBe(200);

      const chunks = await collectSSE(res);
      const events = parseSSEEvents(chunks);

      expect(events).toHaveLength(2);

      // First event: validation error
      expect(events[0]!.event).toBe("error");
      const errorData = events[0]!.data as {
        message: string;
        issues: unknown[];
      };
      expect(errorData.message).toContain("Validation failed");
      expect(errorData.issues.length).toBeGreaterThan(0);

      // Second event: valid data went through
      expect(events[1]).toEqual({ event: "result", data: { score: 0.95 } });
    });
  });

  describe("when an SSE endpoint declares a query schema", () => {
    it("parses query input on its GET route", async () => {
      const app = createService({ name: "test", basePath: "/api/test" })
        .version("2025-03-15", (v) => {
          v.sse(
            "/stream",
            {
              events: { ready: z.object({ channel: z.string() }) },
              query: z.object({ channel: z.string() }),
            },
            async (_c, { query }, stream) => {
              await stream.emit("ready", { channel: query.channel });
            },
          );
        })
        .build();

      const res = await app.request(
        "/api/test/2025-03-15/stream?channel=updates",
      );
      const events = parseSSEEvents(await collectSSE(res));

      expect(events).toEqual([
        { event: "ready", data: { channel: "updates" } },
      ]);
    });
  });

  describe("when an SSE handler throws", () => {
    it("reports the error through the configured framework error handler", async () => {
      const onError = vi.fn((error: Error, c) =>
        c.json({ message: error.message }, 500),
      );
      const app = createService({
        name: "test",
        basePath: "/api/test",
        logger: false,
        tracer: false,
        onError,
      })
        .version("2025-03-15", (v) => {
          v.sse(
            "/stream",
            { events: { result: z.object({ score: z.number() }) } },
            async () => {
              throw new Error("stream failed");
            },
          );
        })
        .build();

      const response = await app.request("/api/test/2025-03-15/stream");
      const events = parseSSEEvents(await collectSSE(response));

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "stream failed" }),
        expect.anything(),
      );
      expect(events).toContainEqual({ event: "error", data: "stream failed" });
    });
  });
});

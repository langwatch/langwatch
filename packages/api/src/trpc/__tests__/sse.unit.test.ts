/** @vitest-environment node */

import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { LiveStreamCrossSiteBlockedError } from "../../errors.ts";
import { SseLane } from "../sse.ts";

type LogRecord = { level: string; fields: unknown; message: string | undefined };

function recordingLogger(records: LogRecord[]) {
  const at =
    (level: string) =>
    (fields: unknown, message?: string): void => {
      records.push({ level, fields, message });
    };

  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}

describe("a live subscription whose store has no connection to give", () => {
  /** @scenario "A live subscription whose store has no connection to give ends with the handled 503" */
  it("ends with the handled database_busy frame, logged as a platform fault", async () => {
    const records: LogRecord[] = [];

    const lane = SseLane.create({
      members: {
        createCaller: async () => ({
          traces: {
            watch: async () => {
              throw Object.assign(
                new Error("Timed out fetching a new connection from the connection pool"),
                { code: "P2024" },
              );
            },
          },
        }),
        procedureTypeAt: () => "subscription",
      },
      logger: recordingLogger(records),
    });

    const response = await lane.answer(
      new Request("http://api.test/api/sse/traces/watch", {
        headers: { "sec-fetch-site": "same-origin" },
      }),
      new Headers(),
    );

    const stream = await response.text();

    expect(stream).toContain('"message":"database_busy"');
    expect(stream).toContain('"retryable":true');

    expect(records).toContainEqual({
      level: "error",
      fields: expect.objectContaining({
        handledErrorCode: "database_busy",
        handledErrorFault: "platform",
      }),
      message: "SSE handler error",
    });
  });
});

describe("a live subscription the client closed", () => {
  /** @scenario "A live subscription the client closed is not logged as a failure" */
  it("logs nothing when the stream rejects with the client's abort", async () => {
    const records: LogRecord[] = [];
    const client = new AbortController();
    let rejected!: () => void;
    const settled = new Promise<void>((resolve) => (rejected = resolve));

    const lane = SseLane.create({
      members: {
        createCaller: async ({ signal }) => ({
          presence: {
            onPresenceUpdate: async function* () {
              await new Promise((_resolve, reject) =>
                signal?.addEventListener("abort", () => {
                  reject(new DOMException("The operation was aborted", "AbortError"));
                  setTimeout(rejected, 0);
                }),
              );
              yield undefined;
            },
          },
        }),
        procedureTypeAt: () => "subscription",
      },
      logger: recordingLogger(records),
    });

    const response = await lane.answer(
      new Request("http://api.test/api/sse/presence/onPresenceUpdate", {
        headers: { "sec-fetch-site": "same-origin" },
        signal: client.signal,
      }),
      new Headers(),
    );
    client.abort();
    await response.text();
    await settled;

    expect(records.filter((record) => record.level === "error")).toEqual([]);
  });
});

describe("a live subscription whose signal aborted before the stream started", () => {
  /** @scenario "A live subscription whose own signal aborted is the stream closing, not a failure" */
  it("logs nothing at error, while a genuine failure on a live signal still does", async () => {
    const records: LogRecord[] = [];
    const client = new AbortController();
    client.abort();

    const laneFailing = (failure: Error) =>
      SseLane.create({
        members: {
          createCaller: async () => ({
            presence: {
              cursors: async function* () {
                await Promise.reject(failure);
                yield undefined;
              },
            },
          }),
          procedureTypeAt: () => "subscription",
        },
        logger: recordingLogger(records),
      });

    const open = (lane: SseLane, signal: AbortSignal) =>
      lane.answer(
        new Request("http://api.test/api/sse/presence/cursors", {
          headers: { "sec-fetch-site": "same-origin" },
          signal,
        }),
        new Headers(),
      );

    const aborted = await open(
      laneFailing(new DOMException("The operation was aborted", "AbortError")),
      client.signal,
    );
    await aborted.text();

    expect(records.filter((record) => record.level === "error")).toEqual([]);

    const failed = await open(laneFailing(new Error("boom")), new AbortController().signal);
    await failed.text();

    expect(records.filter((record) => record.level === "error")).toHaveLength(1);
  });
});

describe("a live subscription the access policy refuses", () => {
  /** @scenario "A live subscription refused for access is logged as a warning, not an error" */
  it.each(["UNAUTHORIZED", "FORBIDDEN"] as const)(
    "logs a bare %s as a warning and nothing at error",
    async (code) => {
      const records: LogRecord[] = [];
      const lane = SseLane.create({
        members: {
          createCaller: async () => ({
            traces: {
              watch: async () => {
                throw new TRPCError({ code });
              },
            },
          }),
          procedureTypeAt: () => "subscription",
        },
        logger: recordingLogger(records),
      });

      const response = await lane.answer(
        new Request("http://api.test/api/sse/traces/watch", {
          headers: { "sec-fetch-site": "same-origin" },
        }),
        new Headers(),
      );
      await response.text();

      expect(records.filter((record) => record.level === "error")).toEqual([]);
      expect(records).toContainEqual(
        expect.objectContaining({ level: "warn", message: "SSE handler error" }),
      );
    },
  );
});

describe("a live subscription opened on a deployment served over plain HTTP", () => {
  const laneFor = ({ plainHttp }: { plainHttp: boolean }) =>
    SseLane.create({
      plainHttp,
      members: {
        createCaller: async () => ({
          traces: {
            watch: async function* () {
              yield "tick";
            },
          },
        }),
        procedureTypeAt: () => "subscription",
      },
      logger: recordingLogger([]),
    });
  const unsignalled = (accept: string) =>
    new Request("http://langwatch.internal:5560/api/sse/traces/watch", { headers: { accept } });

  /** @scenario "A same-origin live stream on a plain-HTTP install opens" */
  it("streams to the app's own EventSource, which sends neither Sec-Fetch-Site nor Origin", async () => {
    const response = await laneFor({ plainHttp: true }).answer(
      unsignalled("text/event-stream"),
      new Headers(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.body?.cancel();
  });

  /** @scenario "A navigation to the live update channel on a plain-HTTP install is refused" */
  it("refuses a navigation, which asks for a document", async () => {
    await expect(
      laneFor({ plainHttp: true }).answer(unsignalled("text/html"), new Headers()),
    ).rejects.toBeInstanceOf(LiveStreamCrossSiteBlockedError);
  });

  /** @scenario "An HTTPS install keeps refusing an unsignalled live stream" */
  it("keeps refusing the same request on an HTTPS deployment", async () => {
    await expect(
      laneFor({ plainHttp: false }).answer(unsignalled("text/event-stream"), new Headers()),
    ).rejects.toBeInstanceOf(LiveStreamCrossSiteBlockedError);
  });
});

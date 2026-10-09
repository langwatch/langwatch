/** @vitest-environment node */

import { describe, expect, it } from "vitest";

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

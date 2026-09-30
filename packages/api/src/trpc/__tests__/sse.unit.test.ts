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
  it("ends with the handled service_unavailable frame, logged as a platform fault", async () => {
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

    expect(stream).toContain('"message":"service_unavailable"');
    expect(stream).toContain('"retryable":true');

    expect(records).toContainEqual({
      level: "error",
      fields: expect.objectContaining({
        handledErrorCode: "service_unavailable",
        handledErrorFault: "platform",
      }),
      message: "SSE handler error",
    });
  });
});

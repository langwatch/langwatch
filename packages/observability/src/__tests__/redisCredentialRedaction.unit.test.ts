/**
 * ioredis attaches the failed command to a reply error, so a rejected AUTH
 * carries the Redis password in `command.args`. These tests read the emitted
 * line through the real serializer map and check the password never lands in
 * it, under every key the platform logs an error with.
 */

import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { NODE_LOG_SERIALIZERS } from "../logger";

function captureLines(run: (logger: pino.Logger) => void): string[] {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const logger = pino(
    { level: "debug", serializers: NODE_LOG_SERIALIZERS },
    sink,
  );
  run(logger);
  return chunks.join("").split("\n").filter(Boolean);
}

/** The error ioredis emits when the server rejects the password. */
function wrongPassError(): Error {
  return Object.assign(
    new Error("WRONGPASS invalid username-password pair or user is disabled."),
    {
      name: "ReplyError",
      command: { name: "auth", args: ["s3cret-redis-password"] },
    },
  );
}

describe("Redis credentials in logged errors", () => {
  describe("when a failed AUTH is logged as an error", () => {
    /** @scenario "the Redis password never reaches the logs" */
    it("redacts the command arguments and keeps the message", () => {
      const [line] = captureLines((logger) =>
        logger.error({ error: wrongPassError() }, "redis error"),
      );

      expect(line).not.toContain("s3cret-redis-password");
      const record = JSON.parse(line ?? "{}");
      expect(record.error.command).toEqual({
        name: "auth",
        args: ["[redacted]"],
      });
      expect(record.error.message).toContain("WRONGPASS");
    });
  });

  describe("when a failed AUTH reaches the unhandled-rejection handler", () => {
    /** @scenario "the Redis password never reaches the logs" */
    it("redacts it under the reason key too", () => {
      const [line] = captureLines((logger) =>
        logger.fatal(
          { reason: wrongPassError() },
          "unhandled rejection detected",
        ),
      );

      expect(line).not.toContain("s3cret-redis-password");
      expect(JSON.parse(line ?? "{}").reason.message).toContain("WRONGPASS");
    });
  });

  describe("when HELLO carries AUTH", () => {
    it("redacts every argument", () => {
      const error = Object.assign(new Error("WRONGPASS"), {
        command: { name: "hello", args: [3, "AUTH", "default", "pw-in-hello"] },
      });
      const [line] = captureLines((logger) =>
        logger.error({ error }, "redis error"),
      );

      expect(line).not.toContain("pw-in-hello");
    });
  });

  describe("when another command fails", () => {
    it("keeps its arguments", () => {
      const error = Object.assign(new Error("WRONGTYPE"), {
        command: { name: "get", args: ["some-key"] },
      });
      const [line] = captureLines((logger) =>
        logger.error({ error }, "redis error"),
      );

      expect(JSON.parse(line ?? "{}").error.command.args).toEqual([
        "some-key",
      ]);
    });
  });
});

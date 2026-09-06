/**
 * What a re-keyed cause actually looks like once pino has written it.
 *
 * The other request-logging tests assert on the object handed to the logger,
 * which is one level above the bug this file exists for. pino applies
 * serializers by exact property name and warns about nothing when a key has
 * none: the value goes to `JSON.stringify`, and an `Error` has no enumerable
 * own properties, so it lands as `{}`. Moving a cause from `error` to
 * `requestError` without registering the second key therefore drops the
 * message and the stack - the only reasons the cause is logged at all - while
 * every assertion on the handed-over object still passes.
 *
 * So these tests read the emitted line, through the same serializer map
 * `createLogger` installs.
 */

import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { REQUEST_CAUSE_FIELD } from "../constants";
import { NODE_LOG_SERIALIZERS } from "../logger";
import { logHttpRequest } from "../request/requestLogging";

/**
 * A pino logger wired to the real serializer map, writing where we can read it.
 * `createLogger` takes no destination, so this reproduces its serializer
 * configuration by importing it rather than by restating it.
 */
function captureRecords(run: (logger: pino.Logger) => void) {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });

  const logger = pino(
    {
      level: "debug",
      serializers: NODE_LOG_SERIALIZERS,
      formatters: { level: (label) => ({ level: label.toUpperCase() }) },
    },
    sink,
  );

  run(logger);

  return chunks
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}

const handledCustomer = () =>
  Object.assign(new Error("Free limit of 50000 events reached"), {
    name: "PlanLimitExceededError",
    code: "ERR_PLAN_LIMIT",
    httpStatus: 402,
    fault: "customer",
  });

describe("emitted request-log records", () => {
  describe("given a handled customer error logged below error level", () => {
    function warnRecord() {
      const [record] = captureRecords((logger) => {
        logHttpRequest(logger as never, {
          method: "POST",
          url: "/api/otel/v1/traces",
          statusCode: 402,
          duration: 5,
          userAgent: null,
          error: handledCustomer(),
        });
      });
      return record;
    }

    it("writes it at warn, not error", () => {
      expect(warnRecord()?.level).toBe("WARN");
    });

    it("writes the cause under the re-keyed field", () => {
      expect(warnRecord()?.[REQUEST_CAUSE_FIELD]).toBeDefined();
    });

    /** @scenario A re-keyed cause is still serialised */
    it("keeps the message a bare Error would have dropped", () => {
      expect(warnRecord()?.[REQUEST_CAUSE_FIELD]?.message).toContain(
        "Free limit of 50000 events reached",
      );
    });

    it("keeps the stack", () => {
      expect(warnRecord()?.[REQUEST_CAUSE_FIELD]?.stack).toBeTruthy();
    });

    it("does not emit the cause as an empty object", () => {
      expect(
        Object.keys(warnRecord()?.[REQUEST_CAUSE_FIELD] ?? {}),
      ).not.toHaveLength(0);
    });

    it("carries no field named error, so nothing downstream reads it as one", () => {
      expect(warnRecord()).not.toHaveProperty("error");
    });

    it("still carries the handled attribution alongside it", () => {
      expect(warnRecord()).toMatchObject({
        handledErrorCode: "ERR_PLAN_LIMIT",
        handledErrorFault: "customer",
        errorType: "PlanLimitExceededError",
      });
    });
  });

  describe("given an unhandled error logged at error level", () => {
    function errorRecord() {
      const [record] = captureRecords((logger) => {
        logHttpRequest(logger as never, {
          method: "POST",
          url: "/fail",
          statusCode: 500,
          duration: 10,
          userAgent: null,
          error: new Error("boom"),
        });
      });
      return record;
    }

    /** @scenario A cause on the error field is serialised as it always was */
    it("still writes the cause under error, serialised as before", () => {
      expect(errorRecord()?.error?.message).toBe("boom");
      expect(errorRecord()?.error?.stack).toBeTruthy();
    });

    it("does not also write the re-keyed field", () => {
      expect(errorRecord()).not.toHaveProperty(REQUEST_CAUSE_FIELD);
    });
  });
});

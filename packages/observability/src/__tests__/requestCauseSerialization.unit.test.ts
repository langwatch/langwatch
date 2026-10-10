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
import {
  MAX_SUMMARY_MESSAGE_LENGTH,
  MAX_SUMMARY_STACK_LENGTH,
} from "../request/errorSummary";
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

  describe("given a failure carrying many fields", () => {
    class ZodError extends Error {
      name = "ZodError";
      issues = Array.from({ length: 60 }, (_, i) => ({
        code: "invalid_type",
        path: ["items", i, "name"],
        message: `Expected string at ${i}`,
        expected: "string",
        received: "number",
      }));
      constructor() {
        super("Invalid input");
      }
    }

    const zodLike = () => new ZodError();

    class PrismaClientKnownRequestError extends Error {
      code = "P2002";
      clientVersion = "6.0.0";
      meta = {
        modelName: "Project",
        target: ["organizationId", "slug"],
        driverAdapterError: { cause: { kind: "UniqueConstraint", fields: ["a", "b"] } },
      };
      batchRequestIdx = 0;
      constructor() {
        super("Unique constraint failed on the fields: (`slug`)");
        this.name = "PrismaClientKnownRequestError";
      }
    }

    /** Leaf count of the record, objects by key and arrays by index. */
    function flatten(value: unknown, prefix = ""): string[] {
      if (value === null || typeof value !== "object") return [prefix];
      return Object.entries(value).flatMap(([key, child]) =>
        flatten(child, prefix ? `${prefix}.${key}` : key),
      );
    }

    const fixtures = [
      { name: "ZodError", make: zodLike, code: undefined },
      {
        name: "PrismaClientKnownRequestError",
        make: () => new PrismaClientKnownRequestError(),
        code: "P2002",
      },
    ];

    for (const fixture of fixtures) {
      for (const { label, statusCode, field } of [
        { label: "warn", statusCode: 409, field: REQUEST_CAUSE_FIELD },
        { label: "error", statusCode: 500, field: "error" },
      ]) {
        describe(`when a ${fixture.name} is logged at ${label} level`, () => {
          function emitted() {
            const records = captureRecords((logger) => {
              logHttpRequest(logger as never, {
                method: "POST",
                url: "/api/thing",
                statusCode,
                duration: 5,
                userAgent: null,
                error: fixture.make(),
              });
            });
            return records[0]!;
          }

          /** @scenario A wide failure is logged as a bounded summary */
          it("emits fewer than 20 keys once flattened", () => {
            expect(emitted().level).toBe(label.toUpperCase());
            expect(flatten(emitted()).length).toBeLessThan(20);
          });

          /** @scenario A wide failure is logged as a bounded summary */
          it("carries only type, message, code and stack on the cause", () => {
            const cause = emitted()[field];
            expect(Object.keys(cause).every((k) =>
              ["type", "message", "code", "stack"].includes(k),
            )).toBe(true);
            expect(cause.type).toBe(fixture.name);
            expect(cause.message).toContain(fixture.make().message);
            if (fixture.code) expect(cause.code).toBe(fixture.code);
          });

          /** @scenario Error records carry no superjson metadata */
          it("emits no _superjson field", () => {
            expect(JSON.stringify(emitted())).not.toContain("_superjson");
          });
        });
      }
    }
  });

  describe("given a non-Error thrown at error level", () => {
    function emittedFor(error: unknown) {
      const [record] = captureRecords((logger) => {
        logHttpRequest(logger as never, {
          method: "POST",
          url: "/fail",
          statusCode: 500,
          duration: 10,
          userAgent: null,
          error,
        });
      });
      return record!.error;
    }

    describe("when it is a string", () => {
      /** @scenario A thrown string is logged as its message */
      it("summarises it as type string with the text as message", () => {
        expect(emittedFor("boom")).toEqual({ type: "string", message: "boom" });
      });
    });

    describe("when it is an error-like object", () => {
      const cause = () => emittedFor({
        message: "database unavailable",
        code: "P1001",
      });

      /** @scenario An error-like object keeps its message and code */
      it("keeps its message and code", () => {
        expect(cause()).toMatchObject({
          message: "database unavailable",
          code: "P1001",
        });
      });

      it("emits only type, message, code and stack", () => {
        expect(
          Object.keys(cause()).every((k) =>
            ["type", "message", "code", "stack"].includes(k),
          ),
        ).toBe(true);
      });
    });

    describe("when it is a plain object without a message", () => {
      /** @scenario A thrown plain object is described without its contents */
      it("states a fixed message with the key count only", () => {
        const cause = emittedFor({ reason: "x" });
        expect(cause.message).toBe("Non-error object thrown (1 keys)");
        expect(JSON.stringify(cause)).not.toContain("reason");
      });

      it("labels it Object", () => {
        expect(emittedFor({ reason: "x" }).type).toBe("Object");
      });
    });

    describe("when it is a plain object holding a secret", () => {
      const thrown = { headers: { authorization: "Bearer secret" } };

      it("does not emit the secret", () => {
        expect(JSON.stringify(emittedFor(thrown))).not.toContain(
          "Bearer secret",
        );
      });

      /** @scenario A thrown plain object is described without its contents */
      it("emits neither its keys nor its values", () => {
        const cause = emittedFor(thrown);
        expect(cause.message).toBe("Non-error object thrown (1 keys)");
        expect(JSON.stringify(cause)).not.toContain("headers");
        expect(JSON.stringify(cause)).not.toContain("authorization");
      });
    });

    describe("when it is a string of 5000 characters", () => {
      /** @scenario Long messages and stacks are cut with a marker */
      it("caps the message and marks the cut", () => {
        const { message } = emittedFor("x".repeat(5000));
        expect(message.length).toBeLessThanOrEqual(MAX_SUMMARY_MESSAGE_LENGTH);
        expect(message.endsWith("… [truncated]")).toBe(true);
      });
    });

    describe("when it is an Error with a 20000-character stack", () => {
      /** @scenario Long messages and stacks are cut with a marker */
      it("caps the stack and marks the cut", () => {
        const error = new Error("boom");
        error.stack = "x".repeat(20000);
        const { stack } = emittedFor(error);
        expect(stack.length).toBeLessThanOrEqual(MAX_SUMMARY_STACK_LENGTH);
        expect(stack.endsWith("… [truncated]")).toBe(true);
      });
    });

    describe("when reading the thrown value throws", () => {
      // Only `message` throws: the level choice reads `code` and `httpStatus`
      // before summarising, outside the fallback this test exercises.
      const hostileProxy = () =>
        new Proxy(
          {},
          {
            get(_target, key) {
              if (key === "message") throw new Error("nope");
              return undefined;
            },
          },
        );

      /** @scenario A value that cannot be described still produces a record */
      it("emits the unserializable fallback", () => {
        expect(emittedFor(hostileProxy())).toEqual({
          type: "unknown",
          message: "Unserializable thrown value",
        });
      });
    });

    describe("when it is a circular object with a throwing toString", () => {
      function hostile() {
        const value: Record<string, unknown> = {
          toString() {
            throw new Error("nope");
          },
        };
        value.self = value;
        return value;
      }

      /** @scenario A value that cannot be described still produces a record */
      it("still emits a record", () => {
        expect(() => emittedFor(hostile())).not.toThrow();
        expect(emittedFor(hostile())).toBeDefined();
      });
    });

    describe("when it is an Error wrapping another Error as its cause", () => {
      it("keeps the inner message in the message or stack", () => {
        const cause = emittedFor(
          new Error("outer", { cause: new Error("inner") }),
        );
        expect(`${cause.message}\n${cause.stack}`).toContain("inner");
      });
    });
  });

  describe("given a deserialized ReplyError that is not an Error instance", () => {
    /** @scenario Credentials in a failed Redis command never reach the summary */
    it("does not emit the password anywhere in the line", () => {
      const emitted = JSON.stringify(
        captureRecords((logger) => {
          logHttpRequest(logger as never, {
            method: "POST",
            url: "/api/thing",
            statusCode: 500,
            duration: 5,
            userAgent: null,
            error: {
              name: "ReplyError",
              message:
                "WRONGPASS invalid username-password pair AUTH s3cret-pass",
              command: { name: "auth", args: ["default", "s3cret-pass"] },
            },
          });
        }),
      );
      expect(emitted).toContain("WRONGPASS");
      expect(emitted).not.toContain("s3cret-pass");
    });
  });

  describe("given an ioredis ReplyError carrying the AUTH password", () => {
    const replyError = () =>
      Object.assign(
        new Error("WRONGPASS invalid username-password pair or user is disabled."),
        {
          name: "ReplyError",
          command: { name: "auth", args: ["default", "s3cret-pass"] },
        },
      );

    for (const { label, statusCode } of [
      { label: "warn", statusCode: 409 },
      { label: "error", statusCode: 500 },
    ]) {
      describe(`when it is logged at ${label} level`, () => {
        /** @scenario Credentials in a failed Redis command never reach the summary */
        it("does not emit the password anywhere in the line", () => {
          const emitted = JSON.stringify(
            captureRecords((logger) => {
              logHttpRequest(logger as never, {
                method: "POST",
                url: "/api/thing",
                statusCode,
                duration: 5,
                userAgent: null,
                error: replyError(),
              });
            }),
          );
          expect(emitted).toContain("WRONGPASS");
          expect(emitted).not.toContain("s3cret-pass");
        });
      });
    }
  });
});

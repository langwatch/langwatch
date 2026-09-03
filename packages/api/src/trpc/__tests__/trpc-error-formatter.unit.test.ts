/**
 * The tRPC failure shape, and the one property of it that is easy to lose.
 *
 * A validation failure is recognised STRUCTURALLY — an `issues` array and a
 * `flatten` method — and never with `instanceof z.ZodError`. That is not a
 * style preference. This workspace resolves two zods: `platform/app` and most
 * packages get 4.4.3, while `@langwatch/identity-*` still get 3.25.76, and ten
 * files there import zod. A zod 3 error travelling into zod 4 code is not an
 * instance of zod 4's class, so a nominal check would turn every identity
 * validation failure into an unknown 500 — a failure mode this repo has
 * already been through once.
 *
 * The cases below therefore feed the formatter a zod-shaped error that is
 * deliberately NOT an instance of any local class. If someone swaps the
 * structural check for `instanceof`, this is what goes red.
 *
 * @see dev/docs/plans/zod-4-migration-misses.md
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HandledError } from "@langwatch/handled-error";
import type { TRPCDefaultErrorShape } from "@trpc/server";
import { createTrpcErrorFormatter } from "../trpc-error-formatter.js";

const formatter = createTrpcErrorFormatter({
  causePayload: { payloadFor: () => null },
  traceIds: { find: () => "trace-1" } as never,
});

const shape = {
  message: "the framework's own words",
  code: -32603,
  data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, stack: "…", path: "x" },
} as unknown as TRPCDefaultErrorShape;

const format = (cause: unknown) =>
  formatter({ shape, error: { cause, code: "INTERNAL_SERVER_ERROR" } });

describe("the tRPC error formatter", () => {
  describe("given a validation failure raised by a different copy of zod", () => {
    /**
     * Built by hand rather than imported, so the test states the contract
     * instead of depending on a second install staying present: what the
     * boundary requires is the SHAPE, from whichever zod produced it.
     */
    const foreignZodError = {
      name: "ZodError",
      issues: [{ code: "invalid_type", path: ["email"], message: "Expected string" }],
      flatten: () => ({ formErrors: [], fieldErrors: { email: ["Expected string"] } }),
      message: "[{}]",
    };

    it("is not an instance of this package's zod, which is the whole point", () => {
      expect(foreignZodError instanceof z.ZodError).toBe(false);
    });

    it("still becomes a handled validation error rather than an unknown failure", () => {
      const formatted = format(foreignZodError);

      expect(formatted.message).toBe("validation_error");
      expect(formatted.data.error).toMatchObject({ code: "validation_error" });
    });

    it("carries the field errors, so a form can mark the offending input", () => {
      const formatted = format(foreignZodError);

      expect(formatted.data.error).toMatchObject({
        meta: { fieldErrors: { email: ["Expected string"] } },
      });
    });
  });

  describe("given a validation failure from this package's own zod", () => {
    it("is treated identically", () => {
      const parsed = z.object({ email: z.string() }).safeParse({ email: 1 });

      const formatted = format(parsed.success ? null : parsed.error);

      expect(formatted.message).toBe("validation_error");
    });
  });

  describe("given a failure that is not a validation error at all", () => {
    it("keeps the stack off the wire and reports no handled error", () => {
      const formatted = format(new Error("a database socket died"));

      expect(formatted.data.error).toBeNull();
      expect(formatted.data).not.toHaveProperty("stack");
    });

    it("sends a handled error's code as the message, never its prose", () => {
      class TeapotError extends HandledError {
        constructor() {
          super("validation_error", "prose no one reviewed", { httpStatus: 422 });
        }
      }

      const formatted = format(new TeapotError());

      expect(formatted.message).toBe("validation_error");
    });
  });
});

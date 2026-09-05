/**
 * The authoring rules that must hold in the editor AND at startup.
 *
 * A rule stated only in the types is invisible to a JavaScript-shaped call —
 * an untyped mount, a `as never` cast, a build that skipped the checker — and a
 * rule stated only at startup is found far too late. Both statements come from
 * ONE table here, so a rule cannot be relaxed on one side while the other keeps
 * claiming it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createRestService } from "../builder.js";
import type { RestEndpoint } from "../definition.js";

const input = z.object({ name: z.string() });
const output = z.object({ ok: z.boolean() });

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

/**
 * Whether `.handle()` can be called at all: the type-state collapses `this` to
 * `never` for an incomplete declaration.
 */
type HandleAccepts<TEndpoint extends { handle: (...args: never[]) => unknown }> = [
  ThisParameterType<TEndpoint["handle"]>,
] extends [never]
  ? false
  : true;

/** The type-level halves, one per rule in the table below. */
type _PolicyIsMandatory = Assert<
  Equal<
    HandleAccepts<
      RestEndpoint<unknown, typeof input, typeof output, false, true, true, false, true>
    >,
    false
  >
>;
type _RateLimitIsMandatory = Assert<
  Equal<
    HandleAccepts<
      RestEndpoint<unknown, typeof input, typeof output, true, false, true, false, true>
    >,
    false
  >
>;
type _ResourceLimitIsMandatory = Assert<
  Equal<
    HandleAccepts<
      RestEndpoint<unknown, typeof input, typeof output, true, true, false, false, true>
    >,
    false
  >
>;

/**
 * One row per rule: what the compiler refuses, and the same rule reached from a
 * JavaScript-shaped registration that never met the compiler.
 */
const RULES = [
  {
    rule: "an endpoint declares an access policy",
    editorRefusal: false satisfies _PolicyIsMandatory extends true ? boolean : never,
    declare: (b: RestEndpoint<unknown>) =>
      b.withOutput(output).withoutRateLimit("test").withoutResourceLimit("test"),
    startupMessage: /exactly one of withPermission or withoutPermission/,
  },
  {
    rule: "a public endpoint decides on rate limiting",
    editorRefusal: false satisfies _RateLimitIsMandatory extends true ? boolean : never,
    declare: (b: RestEndpoint<unknown>) =>
      b.withOutput(output).withoutPermission("test").withoutResourceLimit("test"),
    startupMessage: /must declare a rate limit or a nonblank opt-out reason/,
  },
  {
    rule: "a public endpoint decides on resource limiting",
    editorRefusal: false satisfies _ResourceLimitIsMandatory extends true ? boolean : never,
    declare: (b: RestEndpoint<unknown>) =>
      b.withOutput(output).withoutPermission("test").withoutRateLimit("test"),
    startupMessage: /must declare a resource limit or a nonblank opt-out reason/,
  },
] as const;

/**
 * Registers one incomplete endpoint the way an untyped caller would.
 *
 * `.handle` is reached off a `never`-typed `this` on purpose: that IS the
 * editor's refusal, and stepping around it here is what makes the call
 * JavaScript-shaped, so the startup assert is the only thing left to catch it.
 */
function buildWith(declare: (typeof RULES)[number]["declare"]): void {
  createRestService({ name: "rules", logger: false, tracer: false, maxInputBytes: 1_024 })
    .get("/things", "2026-08-07", ((endpoint: RestEndpoint<unknown>) => {
      const declared = declare(endpoint.withInput(input)) as unknown as {
        handle(handler: () => Promise<{ ok: boolean }>): unknown;
      };
      return declared.handle(async () => ({ ok: true }));
    }) as never)
    .build();
}

describe("API authoring rules", () => {
  describe.each(RULES)(
    "given the rule that $rule",
    ({ editorRefusal, declare, startupMessage }) => {
      it("is refused in the editor", () => {
        // The type-level statement above compiled; this row carries its verdict
        // so a rule cannot be dropped from the table without dropping both.
        expect(editorRefusal).toBe(false);
      });

      /** @scenario A rule that matters is enforced in the editor and at startup */
      it("is refused at startup too, naming the same rule", () => {
        expect(() => buildWith(declare)).toThrow(startupMessage);
      });
    },
  );
});

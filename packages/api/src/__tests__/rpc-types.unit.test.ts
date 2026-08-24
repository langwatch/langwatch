import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestService as createService } from "./test-service.js";
import type { RpcChain } from "../definition.js";
import { isRpcPath, type RpcName } from "../rpc-name.js";

// ---------------------------------------------------------------------------
// The RPC grammar is stated twice — as a type on `register`, and as a regex in
// `assertRpcName`. This file is what stops the two from disagreeing: one table
// of names drives both the compile-time assertions and the runtime ones, so a
// change to either statement that forgets the other fails here.
//
// The type is the one an author meets; the assert is the backstop for the
// callers types cannot reach, which is why the runtime half deliberately casts
// past the signature to reach it.
// ---------------------------------------------------------------------------

const LEGAL = [
  "things.create",
  "endpoints.rollSecret",
  "thingsV2.list",
  "a1.b2",
  "things.nested.get",
] as const;

const ILLEGAL = [
  "/things.create", // leading slash: a name is an identifier, not a path
  "things", // no dot: at least <resource>.<verb>
  "Things.create", // PascalCase resource
  "things.RollSecret", // PascalCase verb
  "things.roll_secret", // snake_case
  "things.roll-secret", // kebab-case
  "2things.create", // leading digit
  "things..create", // empty segment
  "things.", // empty verb
  ".create", // empty resource
  "things.get/:id", // path parameter
  "nested/things.get", // slash
] as const;

// --- compile-time half ------------------------------------------------------

/**
 * `RpcName<T>` resolves to `unknown` exactly when the name is legal, so this
 * reads as "the compiler accepts it".
 */
type CompilerAccepts<T extends string> =
  unknown extends RpcName<T> ? true : false;

/**
 * Applied per element, NOT to the union of them.
 *
 * `RpcName<T>` does not distribute — its checked type is `IsRpcName<T>`, not a
 * naked `T` — so `CompilerAccepts<(typeof ILLEGAL)[number]>` collapses twelve
 * names into one verdict. `IsRpcName` of a mixed union is `boolean`, `boolean
 * extends true` is false, and the whole table reports "rejected" whether one
 * name is accepted or none are. That assertion passed for the wrong reason and
 * would have gone on passing if the grammar sprang a leak.
 *
 * Mapping over the tuple keeps one verdict per name. A single accepted illegal
 * name makes its element `true`, `T[number]` widens to `boolean`, and the
 * assertion below stops compiling.
 */
type CompilerAcceptsEach<T extends readonly string[]> = {
  [K in keyof T]: CompilerAccepts<T[K] & string>;
};

type AllTrue<T extends readonly boolean[]> = T[number] extends true
  ? true
  : false;
type AllFalse<T extends readonly boolean[]> = T[number] extends false
  ? true
  : false;

type AssertTrue<T extends true> = T;

export type EveryLegalNameCompiles = AssertTrue<
  AllTrue<CompilerAcceptsEach<typeof LEGAL>>
>;
export type EveryIllegalNameIsRejected = AssertTrue<
  AllFalse<CompilerAcceptsEach<typeof ILLEGAL>>
>;

const output = z.object({ id: z.string() });
const handler = async () => ({ id: "1" });

/**
 * Never called. It exists so `tsc` reads it, which is the assertion: each
 * `@ts-expect-error` fails the typecheck if the call it sits on starts
 * compiling, and the un-annotated calls fail it if they stop.
 */
export function rpcRegistrationsTheCompilerJudges(): void {
  const service = createService({ name: "things" });

  service.register("things.create", "2026-08-07", handler, (b) =>
    b.withOutput(output),
  );
  service.register("things.nested.get", "2026-08-07", handler, (b) =>
    b.withOutput(output),
  );

  service.register(
    // @ts-expect-error a name with no dot is a REST path, not an RPC
    "things",
    "2026-08-07",
    handler,
    (b) => b.withOutput(output),
  );
  service.register(
    // @ts-expect-error the resource segment is lower camelCase
    "Things.create",
    "2026-08-07",
    handler,
    (b) => b.withOutput(output),
  );
  service.register(
    // @ts-expect-error underscores are not camelCase
    "things.roll_secret",
    "2026-08-07",
    handler,
    (b) => b.withOutput(output),
  );
  service.register(
    // @ts-expect-error a dotted name has no `:param` to bind
    "things.get/:id",
    "2026-08-07",
    handler,
    (b) => b.withOutput(output),
  );
  service.register(
    // @ts-expect-error a name is an identifier, not a path: no leading slash
    "/things.create",
    "2026-08-07",
    handler,
    (b) => b.withOutput(output),
  );

  service.register("things.get", "2026-08-07", handler, (b) =>
    // @ts-expect-error arguments travel in the JSON body: use `withInput`
    b.withParams(z.object({ id: z.string() })).withOutput(output),
  );
  service.register("things.list", "2026-08-07", handler, (b) =>
    // @ts-expect-error a query string would smuggle arguments back into the URL
    b.withQuery(z.object({ cursor: z.string() })).withOutput(output),
  );

  // A bare endpoint declares no chain, and gets `input: undefined`.
  service.register("things.ping", "2026-08-07", async (_c, input) => {
    // @ts-expect-error an endpoint without withInput receives `undefined`
    const _never: string = input;
    return new Response("pong");
  });

  service.register(
    "things.missingInputSchema",
    "2026-08-07",
    async (_c, input: { id: string }) => new Response(input.id),
    // @ts-expect-error a declared handler input requires withInput
    (b) => b.withDocs({ summary: "missing input schema" }),
  );

  service.register(
    "things.missingOptionalInputSchema",
    "2026-08-07",
    async (_c, input?: { id: string }) => new Response(input?.id),
    // @ts-expect-error an optional declared handler input still requires withInput
    (b) => b.withDocs({ summary: "missing optional input schema" }),
  );

  service.register(
    "things.missingOutputSchema",
    "2026-08-07",
    async () => ({ id: "1" }),
    // @ts-expect-error a data-returning handler requires withOutput
    (b) => b.withDocs({ summary: "missing output schema" }),
  );
}

export function applicationContextTheCompilerJudges(): void {
  createService<unknown, { things: { list(): Promise<unknown[]> } }>({
    name: "things",
    // @ts-expect-error the resolver must return the application handlers receive
    app: () => ({ wrong: true }),
  });

  createService<unknown, { things: { list(): Promise<unknown[]> } }>({
    name: "things",
    app: () => ({ things: { list: async () => [] } }),
  });
}

export function requestCapabilitiesTheCompilerJudges(
  context: import("../types.js").ServiceContext,
): void {
  void context.authorize("traces:view");
  // @ts-expect-error dynamic authorization accepts only registry permissions
  void context.authorize("anything:anywhere");
}

/**
 * The chain offers capabilities, not signatures (@typecheck half of
 * fluent-registration's "the chain offers capabilities" scenario): every
 * capability is a chain call, so adding one never changes the register
 * signature.
 */
export function theChainOffersCapabilities(b: RpcChain): void {
  b.withInput(z.object({}))
    .withOutput(z.object({}))
    .withStatus(201)
    .withDocs({
      summary: "s",
      description: "d",
      operationId: "op",
      tags: ["t"],
    })
    .withAuth("none")
    .withResourceLimit("things")
    .withMiddleware(async (_c, next) => next())
    .withMeta({ policy: "things:read" })
    .withRateLimit()
    .withCache("things", 60)
    .withDeprecated("use things.createV2")
    .withoutCache()
    .withoutRateLimit();

  // @ts-expect-error the chain is not a bag: arbitrary config keys are not offered
  b.withAnythingElse(201);
}

// --- runtime half -----------------------------------------------------------

type UntypedHandler = (...args: never[]) => unknown;

/**
 * The shape of `register` before the type guard existed. Registering through
 * it is how a JavaScript caller, or a name that lost its literal type on the
 * way through a helper, still arrives — and the whole reason the asserts stayed.
 */
type UntypedRegister = (
  name: string,
  version: string,
  handler: UntypedHandler,
  define: (b: never) => RpcChain,
) => void;

function registerThroughUntypedCaller(name: string): void {
  const service = createService({ name: "things" });
  (service.register as unknown as UntypedRegister)(
    name,
    "2026-08-07",
    handler as UntypedHandler,
    (b) => (b as RpcChain).withOutput(output),
  );
}

describe("the RPC grammar", () => {
  describe("given a caller the types cannot reach", () => {
    describe("when it registers a legal name", () => {
      it.each(LEGAL)("accepts %s", (name) => {
        expect(() => registerThroughUntypedCaller(name)).not.toThrow();
      });
    });

    describe("when it registers a name the compiler would have rejected", () => {
      it.each(ILLEGAL)("still refuses %s at registration", (name) => {
        expect(() => registerThroughUntypedCaller(name)).toThrow(
          /dotted <resource>\.<verb>/,
        );
      });
    });
  });

  // The discovery catalogue asks this same grammar to recognise an RPC name
  // after the fact — it must agree with both statements above.
  describe("isRpcPath", () => {
    it.each(LEGAL)("recognises %s", (name) => {
      expect(isRpcPath(name)).toBe(true);
    });

    it.each(ILLEGAL)("rejects %s", (name) => {
      expect(isRpcPath(name)).toBe(false);
    });
  });
});

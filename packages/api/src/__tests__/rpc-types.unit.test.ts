import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createService } from "../builder.js";
import type { EndpointConfig } from "../types.js";
import type { RpcPath } from "../version-builder.js";

// ---------------------------------------------------------------------------
// The RPC grammar is stated twice — as a type on `v.rpc`, and as a regex in
// `assertRpcPath`. This file is what stops the two from disagreeing: one table
// of names drives both the compile-time assertions and the runtime ones, so a
// change to either statement that forgets the other fails here.
//
// The type is the one an author meets; the assert is the backstop for the
// callers types cannot reach, which is why the runtime half deliberately casts
// past the signature to reach it.
// ---------------------------------------------------------------------------

const LEGAL = [
  "/things.create",
  "/things.rollSecret",
  "/thingsV2.list",
  "/a1.b2",
  "/things.nested.get",
] as const;

const ILLEGAL = [
  "/things", // no dot: that is a REST path
  "/Things.create", // PascalCase resource
  "/things.RollSecret", // PascalCase verb
  "/things.roll_secret", // snake_case
  "/things.roll-secret", // kebab-case
  "/2things.create", // leading digit
  "/things..create", // empty segment
  "/things.", // empty verb
  "/.create", // empty resource
  "/things.get/:id", // path parameter
  "/nested/things.get", // slash
  "things.create", // no leading slash
] as const;

// --- compile-time half ------------------------------------------------------

/**
 * `RpcPath<T>` resolves to `unknown` exactly when the name is legal, so this
 * reads as "the compiler accepts it". Both conditionals distribute over the
 * union, so one wrong name turns the result into `boolean` and the assertion
 * below stops compiling — the table is checked entry by entry, not in bulk.
 */
type CompilerAccepts<T extends string> = unknown extends RpcPath<T>
  ? true
  : false;

type AssertTrue<T extends true> = T;
type AssertFalse<T extends false> = T;

export type EveryLegalNameCompiles = AssertTrue<
  CompilerAccepts<(typeof LEGAL)[number]>
>;
export type EveryIllegalNameIsRejected = AssertFalse<
  CompilerAccepts<(typeof ILLEGAL)[number]>
>;

const output = z.object({ id: z.string() });
const handler = async () => ({ id: "1" });

/**
 * Never called. It exists so `tsc` reads it, which is the assertion: each
 * `@ts-expect-error` fails the typecheck if the call it sits on starts
 * compiling, and the un-annotated calls fail it if they stop.
 */
export function rpcRegistrationsTheCompilerJudges(): void {
  createService({ name: "things" }).version("2026-08-07", (v) => {
    v.rpc("/things.create", { output }, handler);
    v.rpc("/things.nested.get", { output }, handler);

    v.rpc(
      // @ts-expect-error a name with no dot is a REST path, not an RPC
      "/things",
      { output },
      handler,
    );
    v.rpc(
      // @ts-expect-error the resource segment is lower camelCase
      "/Things.create",
      { output },
      handler,
    );
    v.rpc(
      // @ts-expect-error underscores are not camelCase
      "/things.roll_secret",
      { output },
      handler,
    );
    v.rpc(
      // @ts-expect-error a dotted name has no `:param` to bind
      "/things.get/:id",
      { output },
      handler,
    );
    v.rpc(
      // @ts-expect-error an endpoint path starts with "/"
      "things.create",
      { output },
      handler,
    );

    v.rpc(
      "/things.get",
      {
        // @ts-expect-error arguments travel in the JSON body: use `input`
        params: z.object({ id: z.string() }),
        output,
      },
      handler,
    );
    v.rpc(
      "/things.list",
      {
        // @ts-expect-error a query string would smuggle arguments back into the URL
        query: z.object({ cursor: z.string() }),
        output,
      },
      handler,
    );
  });
}

// --- runtime half -----------------------------------------------------------

/**
 * The shape of `v.rpc` before the type guard existed. Registering through it is
 * how a JavaScript caller, or a config that lost its literal type on the way
 * through a helper, still arrives — and the whole reason the asserts stayed.
 */
type UntypedRpc = {
  rpc: (path: string, config: EndpointConfig, handler: unknown) => void;
};

function registerThroughUntypedCaller(path: string): void {
  createService({ name: "things" }).version("2026-08-07", (v) => {
    (v as unknown as UntypedRpc).rpc(path, { output }, handler);
  });
}

describe("the RPC grammar", () => {
  describe("given a caller the types cannot reach", () => {
    describe("when it registers a legal name", () => {
      it.each(LEGAL)("accepts %s", (path) => {
        expect(() => registerThroughUntypedCaller(path)).not.toThrow();
      });
    });

    describe("when it registers a name the compiler would have rejected", () => {
      it.each(ILLEGAL)("still refuses %s at registration", (path) => {
        expect(() => registerThroughUntypedCaller(path)).toThrow();
      });
    });
  });

});

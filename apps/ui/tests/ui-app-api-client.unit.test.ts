import { describe, expect, expectTypeOf, it } from "vitest";
import { createUiAppApiClient, UI_TRPC_ENDPOINT } from "../src/behavior/ui-feature-transport";

/**
 * The browser's typed door onto the API process's own router.
 *
 * `createUiAppApiClient` is built from `AppRouter`, read type-only from the
 * api process, rather than from a hand-written `*ApiMap`. Two things are
 * pinned. At runtime: a call still leaves on the request lane, addressed to
 * the procedure by the name the server mounts it under — the typed client must
 * not be a second transport with lanes of its own. At type level: the answer
 * comes back as the procedure's answer rather than `any`, which is the whole
 * reason to retire the maps. The type assertions run as no-ops here (neither
 * vitest config enables `typecheck`); they fail `pnpm typecheck`.
 */

/** A transport whose request lane records where every call went. */
function transport(bodies: unknown[] = []) {
  const requests: string[] = [];
  const queue = [...bodies];

  const fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(JSON.stringify(queue.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  return { client: createUiAppApiClient({ fetch }), requests };
}

/** One tRPC result, in the shape the superjson-encoded transport sends back. */
function resultOf(data: unknown): unknown {
  return { result: { data: { json: data } } };
}

describe("given the browser builds its client from the API process's own router", () => {
  describe("when a screen reads an account procedure", () => {
    it("addresses the request to the name the server mounts it under", async () => {
      const wiring = transport([[resultOf({ hasPassword: true })]]);

      await wiring.client.user.hasPassword.query();

      expect(wiring.requests).toHaveLength(1);
      const sent = new URL(wiring.requests[0]!, "http://localhost");
      expect(sent.pathname).toBe(`${UI_TRPC_ENDPOINT}/user.hasPassword`);
    });

    it("hands back the procedure's own answer rather than an untyped one", () => {
      const { client } = transport();

      type Answer = Awaited<ReturnType<typeof client.user.hasPassword.query>>;

      expectTypeOf<Answer>().not.toBeAny();
      expectTypeOf<Answer>().not.toBeUnknown();
    });
  });

  describe("when a screen reads a namespace two owners merged onto one wire name", () => {
    it("reaches the Enterprise dashboard read mounted onto user.*", () => {
      const { client } = transport();

      type Answer = Awaited<ReturnType<typeof client.user.personalUsage.query>>;

      expectTypeOf<Answer>().not.toBeAny();
      expectTypeOf<Answer>().not.toBeUnknown();
    });
  });
});

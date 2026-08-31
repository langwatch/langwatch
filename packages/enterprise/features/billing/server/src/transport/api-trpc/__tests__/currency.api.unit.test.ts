/**
 * @vitest-environment node
 *
 * The `currency.*` surface: the one procedure the pricing pages call, what it
 * reads the answer from, and what it does when there is nothing to read.
 *
 * The detection rule itself is {@link CurrencyService}'s and is covered beside
 * it. What is pinned here is the transport's own contract — that the request
 * is what the answer comes from rather than the input, that a context built
 * without a request still answers, and that the input stays as permissive as
 * the pages have always sent it.
 */
import { Currency } from "@langwatch/enterprise-billing-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { CurrencyTrpcApi, type CurrencyTrpcContext } from "../currency.api";

type TestContext = CurrencyTrpcContext & {
  session: { user: { id: string } } | null;
};

function harness() {
  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: { user: ctx.session.user } } });
  });

  const parsedInputs: unknown[] = [];
  // A plain generic function rather than a spy: the decorator is generic in
  // the procedure it wraps, and a mock erases that to `unknown`.
  const wrapped: unknown[] = [];
  const noPermission = <TProcedure>(procedure: TProcedure): TProcedure => {
    wrapped.push(procedure);
    return (procedure as { use(m: unknown): TProcedure }).use(
      ({ input, next }: { input: unknown; next: () => Promise<unknown> }) => {
        parsedInputs.push(input);
        return next();
      },
    );
  };

  const router = CurrencyTrpcApi.create(trpc, {
    protected: authenticated,
    noPermission,
  });

  return {
    wrapped,
    parsedInputs,
    callerFor: (req: CurrencyTrpcContext["req"]) =>
      router.createCaller({ req, session: { user: { id: "reader" } } }),
    anonymousCaller: router.createCaller({ req: undefined, session: null }),
  };
}

describe("CurrencyTrpcApi", () => {
  describe("given a request the CDN stamped with a country", () => {
    it("answers with that country's currency", async () => {
      const caller = harness().callerFor({ headers: { "x-vercel-ip-country": "US" } });

      await expect(caller.detectCurrency({})).resolves.toEqual({
        currency: Currency.USD,
        country: "US",
      });
    });

    it("reads the euro countries from the same header", async () => {
      const caller = harness().callerFor({ headers: { "cf-ipcountry": "NL" } });

      await expect(caller.detectCurrency({})).resolves.toEqual({
        currency: Currency.EUR,
        country: "NL",
      });
    });
  });

  describe("given a context built with no request at all", () => {
    /**
     * The compatibility callers that build a context without one. The answer
     * has to be the default rather than a refusal: a pricing page that cannot
     * name a country still has prices to show.
     */
    it("answers with the default currency and no country", async () => {
      const caller = harness().callerFor(undefined);

      await expect(caller.detectCurrency({})).resolves.toEqual({
        currency: Currency.EUR,
        country: null,
      });
    });
  });

  describe("when the caller sends a field the procedure names nothing about", () => {
    /**
     * The pages call `detectCurrency({})`, but the parser has always passed
     * anything through. Narrowing it would start refusing a caller that sends
     * a stray field today, and the handler reads the request either way.
     */
    it("accepts it rather than refusing the call", async () => {
      const { callerFor, parsedInputs } = harness();

      await expect(
        callerFor({ headers: { "x-vercel-ip-country": "GB" } }).detectCurrency({
          unexpected: true,
        } as Record<string, unknown>),
      ).resolves.toEqual({ currency: Currency.USD, country: "GB" });
      expect(parsedInputs).toEqual([{ unexpected: true }]);
    });
  });

  describe("given the process's opted-out declaration", () => {
    /**
     * tRPC appends the input parser as a middleware where `.input()` is
     * called, so a policy installed before it runs with `input === undefined`.
     * This surface declares no permission, but the chain the process wraps it
     * in is the same one every other declaration gets — so it is applied in
     * the same place.
     */
    it("wraps a procedure that already parses its input", async () => {
      const { callerFor, wrapped, parsedInputs } = harness();

      await callerFor({ headers: {} }).detectCurrency({});

      expect(wrapped).toHaveLength(1);
      expect(parsedInputs).toEqual([{}]);
    });
  });

  describe("when the caller has no session", () => {
    it("refuses on the process's authenticated procedure", async () => {
      await expect(harness().anonymousCaller.detectCurrency({})).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });
});

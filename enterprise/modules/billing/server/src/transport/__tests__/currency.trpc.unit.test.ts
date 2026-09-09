/**
 * @vitest-environment node
 * The `currency.*` surface: that the answer comes from the request's headers
 * rather than the input, and that the input stays as permissive as ever.
 */
import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
import { Currency } from "@langwatch/enterprise-billing-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { CurrencyService } from "../../services/currency.service.ts";
import { currencyRequestHeadersFact, currencyTrpcTransport } from "../currency.trpc.ts";
import { billingTrpcTestPorts, type BillingTrpcTestContext } from "./billing.trpc.harness.ts";

const trpc = initTRPC.context<BillingTrpcTestContext>().create();

/** The detection service the process composes, and what the mount hands it. */
const currency = CurrencyService.create();

const router = createTrpcRuntime<BillingTrpcTestContext>({
  root: trpc,
  procedure: trpc.procedure,
  ports: billingTrpcTestPorts(),
}).mount(currencyTrpcTransport, () => ({ detectCurrency: (request) => currency.detect(request) }), {
  // The headers are the PROCESS's to read, off the transport it authenticated.
  facts: [bindTrpcFact(currencyRequestHeadersFact, (ctx) => ctx.headers ?? null)],
});

function callerFor(headers: BillingTrpcTestContext["headers"]) {
  return router.createCaller({ actor: { id: "reader" }, headers });
}

describe("given the mounted currency router", () => {
  describe("when its procedures are read", () => {
    it("exposes exactly the one name the pricing pages call, as a query", () => {
      expect(Object.keys(router._def.procedures)).toEqual(["detectCurrency"]);
      expect(
        (router._def.procedures.detectCurrency as { _def: { type: string } })._def.type,
      ).toBe("query");
    });
  });
});

describe("given a request the CDN stamped with a country", () => {
  describe("when the currency is detected", () => {
    it("answers with that country's currency", async () => {
      const caller = callerFor({ "x-vercel-ip-country": "US" });

      await expect(caller.detectCurrency({})).resolves.toEqual({
        currency: Currency.USD,
        country: "US",
      });
    });

    it("reads the euro countries from the same header", async () => {
      const caller = callerFor({ "cf-ipcountry": "NL" });

      await expect(caller.detectCurrency({})).resolves.toEqual({
        currency: Currency.EUR,
        country: "NL",
      });
    });
  });
});

describe("given a mount that resolved no headers at all", () => {
  describe("when the currency is detected", () => {
    /**
     * The callers that build a context with no request. The answer has to be
     * the default rather than a refusal: a pricing page that cannot name a
     * country still has prices to show.
     */
    it("answers with the default currency and no country", async () => {
      const caller = callerFor(null);

      await expect(caller.detectCurrency({})).resolves.toEqual({
        currency: Currency.EUR,
        country: null,
      });
    });
  });
});

describe("when the caller sends a field the procedure names nothing about", () => {
  /**
   * The pages call `detectCurrency({})`, but the parser has always passed
   * anything through. Narrowing it would start refusing a caller that sends a
   * stray field today, and the answer is read from the headers either way.
   */
  it("accepts it rather than refusing the call", async () => {
    const caller = callerFor({ "x-vercel-ip-country": "GB" });

    await expect(
      caller.detectCurrency({ unexpected: true } as Record<string, unknown>),
    ).resolves.toEqual({ currency: Currency.USD, country: "GB" });
  });
});

describe("when the caller has no session", () => {
  it("refuses on the process's authenticated door", async () => {
    const anonymous = router.createCaller({ actor: null, headers: {} });

    await expect(anonymous.detectCurrency({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

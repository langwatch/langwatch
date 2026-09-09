/**
 * The server half of `currency.*`. The rule is the application's — CDN country
 * header, then a geo-IP lookup, then the default. SaaS-only: a self-hosted
 * installation mounts an empty router rather than a surface that guesses.
 */
import { defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import { currencyTrpc, type DetectedCurrency } from "@langwatch/enterprise-billing-contract";
import { featureApi } from "@langwatch/runtime-composition";
import { z } from "zod";

import type { CurrencyRequest } from "../services/currency.service.ts";

/** The currency question this surface asks of the application. */
export interface BillingCurrencyApi {
  /** The reader's currency, and the country it was decided from. */
  detectCurrency(request: CurrencyRequest): DetectedCurrency;
}

export const BillingCurrencyApi = featureApi<BillingCurrencyApi>("billing");

/**
 * The headers this request arrived with, as the PROCESS reads them off its own
 * transport. Null on a mount that has no request, which the application already
 * answers for by falling back to the default currency.
 */
export const currencyRequestHeadersFact = defineTrpcFact(
  "currencyRequestHeaders",
  z.record(z.string(), z.union([z.string(), z.array(z.string())]).optional()).nullable(),
);

/**
 * Nothing to check: a currency catalog is public reference data and the answer
 * is identical for every signed-in caller in the same place.
 */
const PUBLIC_REFERENCE_DATA =
  "answers which of the two currencies a reader's prices are shown in; public reference data, " +
  "no scope id and no tenant read";

export const currencyTrpcTransport = defineTrpcRouter(BillingCurrencyApi, currencyTrpc)
  .procedure("detectCurrency")
  .withFacts(currencyRequestHeadersFact)
  .noPermission({ reason: PUBLIC_REFERENCE_DATA })
  .handle(({ app }, headers) => app.detectCurrency(headers === null ? {} : { headers }))
  .build();

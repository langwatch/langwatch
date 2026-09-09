/**
 * The `currency.*` procedure, declared once: which of the two currencies a
 * reader's prices are shown in, and the country that was decided from. The
 * name is the browser's cache key, so it is the wire name the pages call.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { detectedCurrencySchema } from "./pricing.ts";

/**
 * Anything, and nothing is read from it. Narrowing this would start refusing a
 * caller that sends a stray field today, and the answer comes from the request.
 */
export const detectCurrencyInputSchema = z.object({}).passthrough();

export const currencyTrpc = defineTrpcContract("currency")
  .query("detectCurrency")
  .withInput(detectCurrencyInputSchema)
  .withOutput(detectedCurrencySchema)
  .build();

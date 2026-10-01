/**
 * The legacy `POST /api/analytics` body's refusals, which are not the timeseries family's:
 * `{ message }` for a body that is not JSON, `{ error }` for one that parses and fails validation.
 */
import { analyticsTimeseriesRestBodySchema } from "@langwatch/analytics-contract";
import { zodErrorMessage } from "@langwatch/config";
import type { z } from "zod";

export type AnalyticsLegacyTimeseriesBody = z.infer<typeof analyticsTimeseriesRestBodySchema>;

export type AnalyticsLegacyBodyReading =
  | { readonly accepted: true; readonly body: AnalyticsLegacyTimeseriesBody }
  | {
      readonly accepted: false;
      readonly refusal: { readonly message: string } | { readonly error: string };
    };

/** The body as JSON, or `undefined` for a body that is not JSON at all. */
function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Reads the raw legacy body, refusing in the sentence that family has always answered with. */
export function readLegacyTimeseriesBody(raw: string): AnalyticsLegacyBodyReading {
  const body = parsedJson(raw);
  if (body === undefined) return { accepted: false, refusal: { message: "Bad request" } };

  const parsed = analyticsTimeseriesRestBodySchema.safeParse(body);
  if (!parsed.success) {
    return { accepted: false, refusal: { error: zodErrorMessage(parsed.error) } };
  }

  return { accepted: true, body: parsed.data };
}

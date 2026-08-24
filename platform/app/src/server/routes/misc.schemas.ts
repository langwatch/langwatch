/**
 * OpenAPI schemas for the API-key routes registered in `misc.ts`.
 *
 * The file is a grab-bag of endpoints that predate the per-resource apps, and
 * most of them are still the ones an SDK or a CI job calls. What they have in
 * common is that they parse their bodies by hand and answer their own
 * refusals, so there is no validator schema for the generator to read and the
 * shapes below are written to match what the handlers send.
 *
 * The unannotated siblings in that file — the Stripe webhook, the demo bot,
 * the MCP authorize step, the image proxy — stay out of the document on their
 * own: `generateSpecs` skips any handler without `describeRoute`.
 *
 * These do not validate anything at runtime; the handlers keep their parsing.
 */

import type { DescribeRouteOptions } from "hono-openapi";
import { z } from "zod";

/** The schema slot of a `describeRoute` request body, on hono-openapi's terms. */
type RequestBodySchema = NonNullable<
  Extract<
    NonNullable<DescribeRouteOptions["requestBody"]>,
    { content: unknown }
  >["content"][string]["schema"]
>;

/**
 * A zod schema as a `requestBody` schema object.
 *
 * `resolver()` is the normal way to put a zod schema into `describeRoute`, but
 * it only types against `responses`; hono-openapi wants a plain schema object
 * under `requestBody`. Every route in this file parses its body by hand, so
 * there is no `zValidator` for the generator to read one off either.
 *
 * `$refStrategy: "none"` inlines nested schemas rather than emitting
 * `#/definitions/...` pointers, which would resolve to nothing once the
 * fragment is merged into a document whose components live elsewhere.
 */
export const requestBodySchema = (schema: z.ZodTypeAny): RequestBodySchema =>
  z.toJSONSchema(schema, {
    target: "openapi-3.0",
    reused: "inline",
  }) as RequestBodySchema;

/**
 * A hand-rolled refusal from one of these handlers.
 *
 * They predate ADR-045 and answer a sentence rather than a stable code, in one
 * of two fields depending on where the request failed: `message` when the body
 * was not JSON at all or the route rejected it wholesale, `error` when it
 * parsed and then failed validation. Documented as sent — there is no code to
 * branch on here, so a caller has the status and the sentence.
 */
export const legacySentenceErrorSchema = z.object({
  message: z
    .string()
    .optional()
    .describe("Set when the request was rejected before validation"),
  error: z
    .string()
    .optional()
    .describe("Set when the body parsed and then failed validation"),
});

/** What an accepted write answers with when there is nothing to return. */
export const acknowledgementSchema = z.object({
  message: z.string().describe("Human-readable confirmation"),
});

/**
 * The timeseries answer, as the analytics service builds it.
 *
 * Each period is one row per bucket. The keys inside a row are the series the
 * request asked for, so they vary per call and are deliberately open.
 */
export const analyticsTimeseriesResponseSchema = z.object({
  currentPeriod: z
    .array(z.record(z.string(), z.unknown()))
    .describe("One row per time bucket over the requested range"),
  previousPeriod: z
    .array(z.record(z.string(), z.unknown()))
    .describe("The same range shifted back by its own length, for comparison"),
});

/**
 * What a synchronous workflow run answers with.
 *
 * `result` is the workflow's own output, keyed by its output field names, so
 * it is different for every workflow and cannot be narrowed here. `status` is
 * the execution state the engine finished in.
 */
export const workflowRunResponseSchema = z.object({
  status: z
    .enum(["idle", "waiting", "running", "success", "error", "skipped"])
    .describe("Execution state the run finished in"),
  result: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe("The workflow's output fields, named as the workflow names them"),
});

/**
 * `POST /api/analytics` — the timeseries family's SECOND path.
 *
 * It answers the same question `POST /api/analytics/timeseries` does, off the
 * same {@link AnalyticsApp}, and it exists as its own family for one reason:
 * its refusals are not that family's. This door answers a bare
 * `{ message: "Bad request" }` when the body is not JSON, `{ error: <sentence> }`
 * when it parses and then fails validation, and `{ code, message }` when the
 * application raises a bad-request — where the canonical path answers the
 * framework's own envelope.
 *
 * Registering it as an alias would change a wire that deployed callers parse,
 * so the two stay apart and this door still reads the body itself, through
 * `withRawBody`: the sentence it answers with is built by `zodErrorMessage`
 * from the schema's own failure, which a promoted `RequestValidationError`
 * cannot reproduce. What it does NOT keep is a second reading of the analytics
 * catalogue: the body is the package's own schema, the same one the canonical
 * door takes.
 */
import { requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  coerceToEpoch,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  projectOf,
  resolver,
  type ServiceContext,
} from "@langwatch/api/rest";
import { zodErrorMessage } from "@langwatch/config";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { timeseriesResponseSchema, type AnalyticsTimeseriesRestBody } from "./analytics.api.ts";

/** The two shapes this door answers a refusal in, as it has always sent them. */
const legacySentenceErrorSchema = z.object({
  message: z.string().optional().describe("Set when the request was rejected before validation"),
  error: z.string().optional().describe("Set when the body parsed and then failed validation"),
});

/**
 * A refusal this door renders itself, rather than through either envelope.
 */
class LegacyAnalyticsRefusal extends Error {
  constructor(readonly body: Record<string, string>) {
    super(body.message ?? body.error ?? "Bad request");
    this.name = "LegacyAnalyticsRefusal";
  }
}

/** REST for the legacy analytics path, built against one process's security. */
export function createAnalyticsLegacyRestApp<
  TBody extends AnalyticsTimeseriesRestBody,
  TBodyRaw,
>(options: {
  security: AppRestSecurity;
  analytics: () => AnalyticsApi;
  /** The same body the canonical door takes, with its two accepted date spellings. */
  requestSchema: z.ZodType<TBody, TBodyRaw>;
}): MountableRestApp {
  const { security, analytics, requestSchema } = options;

  // The basePath is `/api` and the route is `/analytics`, because the path is
  // a literal sibling of `/api/analytics/timeseries` rather than a child of
  // it: mounting it under `/api/analytics` would make its own path
  // `/api/analytics/`, which is a different URL. `bareMount` keeps the family
  // off a version namespace it would otherwise claim for every sibling at
  // `/api`.
  const { service, policy } = security.createProjectVersionedApp({
    name: "analytics-legacy",
    basePath: "/api",
    bareMount: true,
    errorEnvelope: "legacy",
    errorHandler: (boundary) => (error, c) =>
      error instanceof LegacyAnalyticsRefusal ? c.json(error.body, 400) : boundary(error, c),
  });

  const timeseriesHandler = async (
    c: ServiceContext<EndpointVariables>,
    input: { body: string },
  ) => {
    let body: unknown;
    try {
      body = JSON.parse(input.body);
    } catch {
      throw new LegacyAnalyticsRefusal({ message: "Bad request" });
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      throw new LegacyAnalyticsRefusal({ error: zodErrorMessage(parsed.error) });
    }

    try {
      return await analytics().getTimeseries({
        ...parsed.data,
        projectId: projectOf(c).id,
        startDate: coerceToEpoch(parsed.data.startDate),
        endDate: coerceToEpoch(parsed.data.endDate),
      });
    } catch (error) {
      if (error instanceof TRPCError && error.code === "BAD_REQUEST") {
        throw new LegacyAnalyticsRefusal({ code: error.code, message: error.message });
      }
      throw error;
    }
  };

  return service
    .registerRoute("post", "/analytics", MANAGEMENT_API_VERSION, timeseriesHandler, (b) =>
      policy(requires("analytics:view"))(b)
        .withRawBody("text", { contentType: "application/json" })
        .withOutput(timeseriesResponseSchema)
        .withDocs({
          operationId: "queryAnalyticsTimeseriesLegacy",
          summary: "Query analytics timeseries (legacy path)",
          description:
            "Query analytics timeseries with metrics, aggregations and filters. Identical to `POST /api/analytics/timeseries`, which is the path to use in new integrations; this one stays for callers written against it.",
          tags: ["Analytics"],
          responses: {
            400: {
              description: "The body was not valid JSON, or failed validation",
              content: {
                "application/json": { schema: resolver(legacySentenceErrorSchema) },
              },
            },
            401: {
              description: "Missing or invalid API key",
              content: {
                "application/json": { schema: resolver(z.object({ message: z.string() })) },
              },
            },
          },
        }),
    )
    .build();
}

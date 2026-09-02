/**
 * `POST /api/analytics` — the timeseries family's SECOND path.
 *
 * It answers the same question `POST /api/analytics/timeseries` does, off the
 * same {@link AnalyticsApp}, and it exists as its own family for one reason:
 * its refusals are not that family's. This door answers a bare
 * `{ message: "Bad request" }` when the body is not JSON, `{ error: <sentence> }`
 * when it parses and then fails validation, and `{ code, message }` when the
 * application raises a bad-request — where the canonical path answers the
 * framework's own envelope through `zValidator` and an `HTTPException`.
 *
 * Registering it as an alias would change a wire that deployed callers parse,
 * so the two stay apart and the handler below keeps parsing by hand. What it
 * does NOT keep is a second reading of the analytics catalogue: the body is
 * the package's own schema, the same one the canonical door takes, because the
 * enumeration that used to narrow metric names at the wire is a browser
 * module and the metric translator's own refusal is the narrowing now.
 */
import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  coerceToEpoch,
  type SecuredApp,
} from "@langwatch/api/rest";
import { zodErrorMessage } from "@langwatch/config";
import { TRPCError } from "@trpc/server";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import type { AnalyticsApp } from "#app/analytics.app";
import type { AnalyticsTimeseriesRestBody } from "./analytics.api";

/** The two shapes this door answers a refusal in, as it has always sent them. */
const legacySentenceErrorSchema = z.object({
  message: z.string().optional().describe("Set when the request was rejected before validation"),
  error: z.string().optional().describe("Set when the body parsed and then failed validation"),
});

/** REST for the legacy analytics path, built against one process's security. */
export function createAnalyticsLegacyRestApp<
  TBody extends AnalyticsTimeseriesRestBody,
  TBodyRaw,
>(options: {
  security: AppRestSecurity;
  analytics: () => AnalyticsApp;
  /** The same body the canonical door takes, with its two accepted date spellings. */
  requestSchema: z.ZodType<TBody, TBodyRaw>;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, analytics, requestSchema } = options;

  // The basePath is `/api` and the route is `/analytics`, because the path is
  // a literal sibling of `/api/analytics/timeseries` rather than a child of
  // it: mounting it under `/api/analytics` would make its own path
  // `/api/analytics/`, which is a different URL.
  const secured = security.createProjectApp({ basePath: "/api" });

  secured.access(requires("analytics:view")).post(
    "/analytics",
    describeRoute({
      summary: "Query analytics timeseries (legacy path)",
      description:
        "Query analytics timeseries with metrics, aggregations and filters. Identical to `POST /api/analytics/timeseries`, which is the path to use in new integrations; this one stays for callers written against it.",
      tags: ["Analytics"],
      responses: {
        200: {
          description: "Timeseries data for the requested range and the one before it",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  currentPeriod: z.array(z.record(z.string(), z.any())),
                  previousPeriod: z.array(z.record(z.string(), z.any())),
                }),
              ),
            },
          },
        },
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
    async (c) => {
      const project = c.get("project");

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ message: "Bad request" }, 400);
      }

      const parsed = requestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: zodErrorMessage(parsed.error) }, 400);
      }

      try {
        return c.json(
          await analytics().getTimeseries({
            ...parsed.data,
            projectId: project.id,
            startDate: coerceToEpoch(parsed.data.startDate),
            endDate: coerceToEpoch(parsed.data.endDate),
          }),
        );
      } catch (error) {
        if (error instanceof TRPCError && error.code === "BAD_REQUEST") {
          return c.json({ code: error.code, message: error.message }, 400);
        }
        throw error;
      }
    },
  );

  return secured;
}

/**
 * LWQL REST transport.
 *
 * Issue #6346 decision 5: this file contains no query logic. It authenticates,
 * resolves the project, and calls `LwqlService` — the same service the tRPC
 * procedure calls, so the two surfaces cannot drift in what they permit.
 */

import { createLogger } from "@langwatch/observability";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";

import { requires, type SecuredApp } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import {
  describeCatalogue,
  getLwqlService,
  LwqlError,
  lwqlQuerySchema,
} from "~/server/app-layer/lwql";

import type { AuthMiddlewareVariables } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";

const logger = createLogger("langwatch:api:query");

const queryRequestSchema = z
  .object({
    query: z
      .string()
      .max(8000)
      .optional()
      .describe(
        'SQL-like query text, e.g. "SELECT model, avg(cost_usd) FROM traces GROUP BY model".',
      ),
    ir: lwqlQuerySchema
      .optional()
      .describe(
        "Structured query. Equivalent to `query` and subject to identical validation — supply one or the other, not both.",
      ),
  })
  .describe("Either `query` text or a structured `ir`.");

const resultSchema = z.object({
  data: z.array(z.record(z.string(), z.any())),
  meta: z.object({
    row_count: z.number(),
    execution_ms: z.number(),
    truncated: z
      .boolean()
      .describe(
        "True when more rows matched than were returned. Narrow the query or page with OFFSET.",
      ),
    columns: z.array(z.string()),
    sql: z
      .string()
      .optional()
      .describe("Generated SQL. Internal callers only."),
  }),
});

/**
 * Maps an `LwqlError` onto a 400 with a machine-readable code, so callers can
 * branch on `code` while still showing `message` and `hint` to a human.
 *
 * Anything else is left to the framework's error handling — an unexpected
 * failure must not be reported as if the caller's query were at fault.
 */
const errorBody = (error: LwqlError) => ({
  error: {
    code: error.code,
    message: error.message,
    ...(error.hint ? { hint: error.hint } : {}),
    ...(error.position !== undefined ? { position: error.position } : {}),
  },
});

type QueryApp = SecuredApp<{ Variables: AuthMiddlewareVariables }>;

/** POST / — execute a query. */
function registerExecuteRoute(secured: QueryApp): void {
  // POST / — execute a query
  secured.access(requires("traces:view")).post(
    "/",
    describeRoute({
      description:
        "Execute a read-only LWQL query against this project's observability data. Results are always scoped to the authenticated project.",
      responses: {
        ...baseResponses,
        200: {
          description: "Query results",
          content: { "application/json": { schema: resolver(resultSchema) } },
        },
      },
    }),
    zValidator("json", queryRequestSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");

      try {
        const result = await getLwqlService().run(body, {
          projectId: project.id,
          // `explain` is internal-only (issue #6346). A project API key is not
          // an internal caller, so it is never enabled on this transport.
          explain: false,
        });
        return c.json(result);
      } catch (error) {
        if (error instanceof LwqlError) {
          logger.info(
            { projectId: project.id, code: error.code },
            "LWQL query rejected",
          );
          return c.json(errorBody(error), 400);
        }
        throw error;
      }
    },
  );
}

/** POST /validate — compile without executing. */
function registerValidateRoute(secured: QueryApp): void {
  secured.access(requires("traces:view")).post(
    "/validate",
    describeRoute({
      description:
        "Validate and compile a query without executing it. Returns the resolved column list, or the first error with a fix hint.",
      responses: {
        ...baseResponses,
        200: {
          description: "Validation result",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  valid: z.boolean(),
                  columns: z.array(z.string()).optional(),
                  error: z
                    .object({
                      code: z.string(),
                      message: z.string(),
                      hint: z.string().optional(),
                      position: z.number().optional(),
                    })
                    .optional(),
                }),
              ),
            },
          },
        },
      },
    }),
    zValidator("json", queryRequestSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");

      try {
        const result = await getLwqlService().run(body, {
          projectId: project.id,
          dryRun: true,
        });
        return c.json({ valid: true, columns: result.meta.columns });
      } catch (error) {
        if (error instanceof LwqlError) {
          // A failed validation is a successful validation *request* — 200 with
          // `valid: false`, so editors can render the error inline without
          // treating it as a transport failure.
          return c.json({ valid: false, ...errorBody(error) });
        }
        throw error;
      }
    },
  );
}

/** GET /catalogue — the queryable surface. */
function registerCatalogueRoute(secured: QueryApp): void {
  secured.access(requires("traces:view")).get(
    "/catalogue",
    describeRoute({
      description:
        "List queryable entities, fields and types. Contains no tenant data — it describes the language, not the rows.",
      responses: {
        ...baseResponses,
        200: {
          description: "Queryable entities and their fields",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  entities: z.array(
                    z.object({
                      entity: z.string(),
                      fields: z.array(
                        z.object({
                          name: z.string(),
                          type: z.string(),
                          description: z.string(),
                          content_gated: z.boolean(),
                        }),
                      ),
                      content_gated_fields: z.array(z.string()),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => c.json({ entities: describeCatalogue() }),
  );
}

export function registerQueryRoutes(secured: QueryApp): void {
  registerExecuteRoute(secured);
  registerValidateRoute(secured);
  registerCatalogueRoute(secured);
}

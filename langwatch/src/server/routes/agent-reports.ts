/**
 * Intake for issue reports from customers' coding agents:
 * `POST /api/agent-reports`.
 *
 * Public on purpose: the reporter may be struggling precisely because auth or
 * setup failed, so submitting a report must never require credentials. An API
 * key, when present, only links the report to a project. The route stays
 * thin: shape validation here, rate limiting and persistence in the service.
 *
 * See specs/support/agent-issue-reports.feature.
 */
import { HandledError } from "@langwatch/handled-error";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { extractCredentials } from "~/server/api-key/auth-middleware";
import { createServiceApp, publicEndpoint } from "~/server/api/security";
import { submitAgentReport } from "~/server/app-layer/agent-reports/agent-report.service";

const secured = createServiceApp({ basePath: "/api/agent-reports" });

const MAX_BODY_BYTES = 10 * 1024 * 1024;

const agentReportBodySchema = z
  .object({
    source: z.enum(["cli", "mcp"]),
    kind: z.enum(["summary", "full_session"]),
    title: z.string().trim().min(1).max(300),
    summary: z.string().max(200_000).optional(),
    sessionData: z.string().max(9_000_000).optional(),
    sessionTruncated: z.boolean().optional(),
    agent: z.string().max(100).optional(),
    contactEmail: z.string().max(320).optional(),
    cliVersion: z.string().max(50).optional(),
    metadata: z
      .record(z.string().max(200), z.union([z.string().max(2000), z.number(), z.boolean()]))
      .optional(),
  })
  .refine(
    (body) =>
      (body.summary?.trim().length ?? 0) > 0 ||
      (body.sessionData?.trim().length ?? 0) > 0,
    { message: "either summary or sessionData is required" },
  );

/**
 * Rate-limit bucket for the caller. `x-forwarded-for` is only trustworthy
 * from the hop nearest us, which is why this reads the LAST entry: earlier
 * ones are client-supplied.
 */
const callerKey = (c: Context): string => {
  const hops = c.req.header("x-forwarded-for")?.split(",") ?? [];
  const nearest = hops[hops.length - 1]?.trim();
  return `ip:${nearest ?? "unknown"}`;
};

secured
  .access(
    publicEndpoint(
      "Agent issue-report intake; reporters may have no working credentials, an API key only enriches the report with a project link",
    ),
  )
  .post("/", bodyLimit({ maxSize: MAX_BODY_BYTES }), async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Invalid body, expecting JSON" }, 400);
    }

    const parsed = agentReportBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid report", details: parsed.error.flatten() },
        400,
      );
    }

    const credentials = extractCredentials((name) => c.req.header(name));

    try {
      const { id } = await submitAgentReport({
        input: parsed.data,
        callerKey: callerKey(c),
        apiToken: credentials?.token,
        projectIdHint: credentials?.projectId,
      });
      return c.json({ id }, 201);
    } catch (error) {
      if (HandledError.isHandled(error)) {
        return c.json(
          { error: error.message, code: error.code },
          error.httpStatus as 400 | 429 | 500,
        );
      }
      throw error;
    }
  });

export const app = secured.hono;

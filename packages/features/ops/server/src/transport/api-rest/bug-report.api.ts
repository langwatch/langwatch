/**
 * Intake for issue reports from customers' coding agents: `POST
 * /api/bug-reports`.
 */
import { publicEndpoint } from "@langwatch/api";
import { bodyLimit, type AppRestSecurity, type MountableRestApp } from "@langwatch/api/rest";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
import type { Context } from "hono";
import { z } from "zod";

import type { BugReportNotifierPort } from "../../ports/bug-report-notifier.port";
import type { BugReportRateLimiterPort } from "../../ports/bug-report-rate-limiter.port";
import type { BugReportRepositoryPort } from "../../ports/bug-report.port";
import { BugReportIntakeService } from "../../services/bug-report-intake.service";

// Headroom over the 9M-char sessionData cap: JSON escaping can inflate the
// same characters past 10MB, and the zod 400 is the better error than a 413.
const MAX_BODY_BYTES = 12 * 1024 * 1024;

/**
 * The project credential a report MAY carry, as this process reads one off a
 * request.
 */
export type BugReportRestCredentialReader = (
  request: Request,
) => Readonly<{ token: string; projectId: string | null }> | null;

/** Everything the intake reaches that the report itself does not own. */
export type BugReportRestPorts = Readonly<{
  /** Where a filed report is written. */
  reports: () => BugReportRepositoryPort;
  /** The deployment's fixed-window counter, keyed on the nearest-hop IP. */
  rateLimiter: BugReportRateLimiterPort;
  /** Where the team is alerted. Best-effort; intake already succeeded. */
  notifier: BugReportNotifierPort;
  /** Reads the optional project credential off the request. */
  credentials: BugReportRestCredentialReader;
  /**
   * Resolves that credential to a project, where this process has a directory
   * to resolve it through. Absent means every report files unlinked, which is
   * the same degradation an invalid key already produces.
   */
  apiKeys?: (() => ApiKeyService) | undefined;
}>;

const bugReportBodySchema = z
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
    (body) => (body.summary?.trim().length ?? 0) > 0 || (body.sessionData?.trim().length ?? 0) > 0,
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

/** Builds the public `/api/bug-reports` family over one process's ports. */
export function createBugReportsRestApp(options: {
  security: AppRestSecurity;
  ports: BugReportRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api/bug-reports" });

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

      const parsed = bugReportBodySchema.safeParse(json);
      if (!parsed.success) {
        return c.json({ error: "Invalid report", details: parsed.error.flatten() }, 400);
      }

      const credentials = ports.credentials(c.req.raw);
      const apiKeys = ports.apiKeys?.();

      try {
        const intake = BugReportIntakeService.create({
          reports: ports.reports(),
          rateLimiter: ports.rateLimiter,
          notifier: ports.notifier,
        });
        const { id } = await intake.submit({
          input: parsed.data,
          callerKey: callerKey(c),
          ...(credentials ? { apiToken: credentials.token } : {}),
          ...(credentials ? { projectIdHint: credentials.projectId } : {}),
          ...(apiKeys ? { apiKeys } : {}),
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

  return secured.hono;
}

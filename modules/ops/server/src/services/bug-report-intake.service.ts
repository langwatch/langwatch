import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { redactReportText, redactSessionJsonl } from "@langwatch/redaction";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { SubmitBugReport } from "@langwatch/ops-contract";
import type {
  BugReportNotifier,
  BugReportRateLimiter,
} from "../app/ops.app.ts";
import type { BugReportRepository } from "../repositories/admin/bug-report.repository.ts";

const logger = createLogger("langwatch:bug-reports");

/**
 * Intake for the reports customers' coding agents send. Unauthenticated on
 * purpose: the reporter may be struggling because setup failed, so a report
 * must never require a working login. An API key only adds a project link.
 */

export class BugReportRateLimitedError extends HandledError {
  constructor() {
    super("agent_report_rate_limited", "Too many reports, try again later", {
      httpStatus: 429,
      fault: "customer",
    });
  }
}

const RATE_LIMIT_WINDOW_SECONDS = 3600;
const RATE_LIMIT_MAX_PER_WINDOW = 10;

export class BugReportIntakeService {
  static create({
    reports,
    rateLimiter,
    notifier,
  }: {
    reports: BugReportRepository;
    rateLimiter: BugReportRateLimiter;
    notifier: BugReportNotifier;
  }): BugReportIntakeService {
    return new BugReportIntakeService({ reports, rateLimiter, notifier });
  }

  private constructor(
    private readonly deps: {
      reports: BugReportRepository;
      rateLimiter: BugReportRateLimiter;
      notifier: BugReportNotifier;
    },
  ) {}

  async submit({
    input,
    callerKey,
    apiToken,
    projectIdHint,
    apiKeys,
  }: {
    input: SubmitBugReport;
    /** Rate-limit bucket for the caller (nearest-hop IP; self-asserted). */
    callerKey: string;
    apiToken?: string;
    projectIdHint?: string | null;
    apiKeys: ApiKeyApi;
  }): Promise<{ id: string }> {
    const limit = await this.deps.rateLimiter.consume({
      key: `bug-report:${callerKey}`,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      max: RATE_LIMIT_MAX_PER_WINDOW,
    });
    if (!limit.allowed) {
      throw new BugReportRateLimitedError();
    }

    const linkedProjectId = await findLinkedProjectId({
      apiToken,
      projectIdHint,
      apiKeys,
    });

    // Defense in depth: the CLI and MCP redact locally, but the endpoint is
    // public, so a direct POST could carry raw secrets into this cross-tenant,
    // admin-visible inbox. Pattern redaction re-runs here before persisting
    // (no env pass: environment literals are a client-side concern).
    const redacted = redactSubmission(input);

    const report = await this.deps.reports.create({
      data: {
        source: input.source,
        kind: input.kind,
        title: redacted.title,
        summary: redacted.summary,
        sessionData: redacted.sessionData,
        sessionTruncated: input.sessionTruncated ?? false,
        agent: input.agent,
        contactEmail: input.contactEmail,
        cliVersion: input.cliVersion,
        linkedProjectId,
        metadata: redacted.metadata,
      },
    });

    logger.info(
      {
        reportId: report.id,
        source: report.source,
        kind: report.kind,
        agent: report.agent,
        linkedProjectId,
      },
      "bug report received",
    );

    try {
      await this.deps.notifier.notify({ report });
    } catch (error) {
      // The alert is best-effort; intake already succeeded.
      logger.warn({ error, reportId: report.id }, "bug report Slack alert failed");
    }

    return { id: report.id };
  }
}

function redactSubmission(input: SubmitBugReport): {
  title: string;
  summary?: string;
  sessionData?: string;
  metadata?: Record<string, string | number | boolean>;
} {
  return {
    title: redactReportText({ text: input.title }).text,
    summary: input.summary ? redactReportText({ text: input.summary }).text : undefined,
    sessionData: input.sessionData
      ? redactSessionJsonl({ jsonl: input.sessionData }).text
      : undefined,
    metadata: input.metadata
      ? Object.fromEntries(
          Object.entries(input.metadata).map(([key, value]) => [
            key,
            typeof value === "string" ? redactReportText({ text: value }).text : value,
          ]),
        )
      : undefined,
  };
}

/**
 * Best-effort project linkage from an optional API key. Any failure (invalid,
 * expired, malformed) resolves to "not linked" rather than an error: linkage
 * is a nicety, intake is the point.
 */
async function findLinkedProjectId({
  apiToken,
  projectIdHint,
  apiKeys,
}: {
  apiToken?: string | undefined;
  projectIdHint?: string | null;
  apiKeys: ApiKeyApi;
}): Promise<string | null> {
  if (!apiToken) {
    return null;
  }

  try {
    const resolved = await apiKeys.findResolvedToken({
      token: apiToken,
      projectId: projectIdHint ?? null,
    });

    return resolved?.project.id ?? null;
  } catch (error) {
    logger.warn({ error }, "bug report project linkage failed, storing unlinked");

    return null;
  }
}

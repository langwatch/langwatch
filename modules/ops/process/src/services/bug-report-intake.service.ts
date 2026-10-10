import { createLogger } from "@langwatch/observability";
import { BugReportRateLimitedError, type SubmitBugReport } from "@langwatch/ops-contract";
import { redactReportText, redactSessionJsonl } from "@langwatch/redaction";

import type { BugReportNotifier } from "../app/ops.app.ts";
import type {
  BugReportRateLimitRepository,
  BugReportRepository,
} from "../repositories/bug-report.repository.ts";

const logger = createLogger("langwatch:bug-reports");

/**
 * Intake for the reports customers' coding agents send. Unauthenticated on
 * purpose: the reporter may be struggling because setup failed, so a report
 * must never require a working login. An API key only adds a project link.
 */

const RATE_LIMIT_WINDOW_SECONDS = 3600;
const RATE_LIMIT_MAX_PER_WINDOW = 10;

export class BugReportIntakeService {
  static create({
    reports,
    rateLimiter,
    notifier,
  }: {
    reports: BugReportRepository;
    rateLimiter: BugReportRateLimitRepository;
    notifier: BugReportNotifier;
  }): BugReportIntakeService {
    return new BugReportIntakeService({ reports, rateLimiter, notifier });
  }

  private constructor(
    private readonly deps: {
      reports: BugReportRepository;
      rateLimiter: BugReportRateLimitRepository;
      notifier: BugReportNotifier;
    },
  ) {}

  async submit({
    input,
    callerKey,
    linkedProjectId,
  }: {
    input: SubmitBugReport;
    /** Rate-limit bucket for the caller (nearest-hop IP; self-asserted). */
    callerKey: string;
    /** The project the door verified the reporter's key for; null files the report unlinked. */
    linkedProjectId: string | null;
  }): Promise<{ id: string }> {
    const limit = await this.deps.rateLimiter.consume({
      key: `bug-report:${callerKey}`,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      max: RATE_LIMIT_MAX_PER_WINDOW,
    });
    if (!limit.allowed) {
      throw new BugReportRateLimitedError();
    }

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

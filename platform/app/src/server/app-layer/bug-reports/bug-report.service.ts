import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { redactReportText, redactSessionJsonl } from "@langwatch/redaction";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { BugReport } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { rateLimit } from "~/server/rateLimit";
import { BugReportRepository } from "~/server/repositories/bug-report.repository";
import { notifyBugReportOnSlack } from "./bug-report-slack";

const logger = createLogger("langwatch:bug-reports");

/**
 * Intake for issue reports sent by customers' coding agents (the CLI
 * `langwatch report` command and the MCP report tool). Deliberately
 * unauthenticated: the reporter may be struggling precisely because setup
 * failed, so a report must never require a working login. An API key, when
 * present, only enriches the report with a project link and is never a gate.
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

export interface SubmitBugReportInput {
  source: "cli" | "mcp";
  kind: "summary" | "full_session";
  title: string;
  summary?: string;
  sessionData?: string;
  sessionTruncated?: boolean;
  agent?: string;
  contactEmail?: string;
  cliVersion?: string;
  metadata?: Record<string, string | number | boolean>;
}

export type BugReportNotifier = (args: { report: BugReport }) => Promise<void>;

export async function submitBugReport({
  input,
  callerKey,
  apiToken,
  projectIdHint,
  apiKeys,
  notify = notifyBugReportOnSlack,
}: {
  input: SubmitBugReportInput;
  /** Rate-limit bucket for the caller (nearest-hop IP; self-asserted). */
  callerKey: string;
  apiToken?: string;
  projectIdHint?: string | null;
  apiKeys?: ApiKeyService;
  notify?: BugReportNotifier;
}): Promise<{ id: string }> {
  const limit = await rateLimit({
    key: `bug-report:${callerKey}`,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    max: RATE_LIMIT_MAX_PER_WINDOW,
  });
  if (!limit.allowed) throw new BugReportRateLimitedError();

  const linkedProjectId = await resolveLinkedProjectId({
    apiToken,
    projectIdHint,
    apiKeys,
  });

  // Defense in depth: the CLI and MCP redact locally, but the endpoint is
  // public, so a direct POST could carry raw secrets into this cross-tenant,
  // admin-visible inbox. Pattern redaction re-runs here before persisting
  // (no env pass: environment literals are a client-side concern).
  const redacted = redactSubmission(input);

  const repository = new BugReportRepository(prisma);
  const report = await repository.create({
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
    await notify({ report });
  } catch (error) {
    // The alert is best-effort; intake already succeeded.
    logger.warn(
      { error, reportId: report.id },
      "bug report Slack alert failed",
    );
  }

  return { id: report.id };
}

function redactSubmission(input: SubmitBugReportInput): {
  title: string;
  summary?: string;
  sessionData?: string;
  metadata?: Record<string, string | number | boolean>;
} {
  return {
    title: redactReportText({ text: input.title }).text,
    summary: input.summary
      ? redactReportText({ text: input.summary }).text
      : undefined,
    sessionData: input.sessionData
      ? redactSessionJsonl({ jsonl: input.sessionData }).text
      : undefined,
    metadata: input.metadata
      ? Object.fromEntries(
          Object.entries(input.metadata).map(([key, value]) => [
            key,
            typeof value === "string"
              ? redactReportText({ text: value }).text
              : value,
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
async function resolveLinkedProjectId({
  apiToken,
  projectIdHint,
  apiKeys,
}: {
  apiToken?: string;
  projectIdHint?: string | null;
  apiKeys?: ApiKeyService;
}): Promise<string | null> {
  if (!apiToken || !apiKeys) return null;
  try {
    const resolved = await apiKeys.tryResolveToken({
      token: apiToken,
      projectId: projectIdHint ?? null,
    });
    return resolved?.project.id ?? null;
  } catch (error) {
    logger.warn(
      { error },
      "bug report project linkage failed, storing unlinked",
    );
    return null;
  }
}

export async function getAllBugReports({
  page,
  pageSize,
  search,
}: {
  page: number;
  pageSize: number;
  search?: string;
}): Promise<{ reports: Omit<BugReport, "sessionData">[]; total: number }> {
  const repository = new BugReportRepository(prisma);
  const [reports, total] = await Promise.all([
    repository.findAll({ page, pageSize, search }),
    repository.count({ search }),
  ]);
  return { reports, total };
}

export async function getBugReportById({
  id,
}: {
  id: string;
}): Promise<BugReport | null> {
  const repository = new BugReportRepository(prisma);
  return repository.findById({ id });
}

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { AgentReport } from "@prisma/client";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { prisma } from "~/server/db";
import { rateLimit } from "~/server/rateLimit";
import { AgentReportRepository } from "~/server/repositories/agent-report.repository";
import { notifyAgentReportOnSlack } from "./agent-report-slack";

const logger = createLogger("langwatch:agent-reports");

/**
 * Intake for issue reports sent by customers' coding agents (the CLI
 * `langwatch report` command and the MCP report tool). Deliberately
 * unauthenticated: the reporter may be struggling precisely because setup
 * failed, so a report must never require a working login. An API key, when
 * present, only enriches the report with a project link and is never a gate.
 */

export class AgentReportRateLimitedError extends HandledError {
  constructor() {
    super("agent_report_rate_limited", "Too many reports, try again later", {
      httpStatus: 429,
      fault: "customer",
    });
  }
}

const RATE_LIMIT_WINDOW_SECONDS = 3600;
const RATE_LIMIT_MAX_PER_WINDOW = 10;

export interface SubmitAgentReportInput {
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

export type AgentReportNotifier = (args: {
  report: AgentReport;
}) => Promise<void>;

export async function submitAgentReport({
  input,
  callerKey,
  apiToken,
  projectIdHint,
  notify = notifyAgentReportOnSlack,
}: {
  input: SubmitAgentReportInput;
  /** Rate-limit bucket for the caller (nearest-hop IP; self-asserted). */
  callerKey: string;
  apiToken?: string;
  projectIdHint?: string | null;
  notify?: AgentReportNotifier;
}): Promise<{ id: string }> {
  const limit = await rateLimit({
    key: `agent-report:${callerKey}`,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    max: RATE_LIMIT_MAX_PER_WINDOW,
  });
  if (!limit.allowed) throw new AgentReportRateLimitedError();

  const linkedProjectId = await resolveLinkedProjectId({
    apiToken,
    projectIdHint,
  });

  const repository = new AgentReportRepository(prisma);
  const report = await repository.create({
    data: {
      source: input.source,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      sessionData: input.sessionData,
      sessionTruncated: input.sessionTruncated ?? false,
      agent: input.agent,
      contactEmail: input.contactEmail,
      cliVersion: input.cliVersion,
      linkedProjectId,
      metadata: input.metadata,
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
    "agent report received",
  );

  try {
    await notify({ report });
  } catch (error) {
    // The alert is best-effort; intake already succeeded.
    logger.warn({ error, reportId: report.id }, "agent report Slack alert failed");
  }

  return { id: report.id };
}

/**
 * Best-effort project linkage from an optional API key. Any failure (invalid,
 * expired, malformed) resolves to "not linked" rather than an error: linkage
 * is a nicety, intake is the point.
 */
async function resolveLinkedProjectId({
  apiToken,
  projectIdHint,
}: {
  apiToken?: string;
  projectIdHint?: string | null;
}): Promise<string | null> {
  if (!apiToken) return null;
  try {
    const resolved = await TokenResolver.create(prisma).resolve({
      token: apiToken,
      projectId: projectIdHint ?? null,
    });
    return resolved?.project.id ?? null;
  } catch (error) {
    logger.warn({ error }, "agent report project linkage failed, storing unlinked");
    return null;
  }
}

export async function getAllAgentReports({
  page,
  pageSize,
  search,
}: {
  page: number;
  pageSize: number;
  search?: string;
}): Promise<{ reports: Omit<AgentReport, "sessionData">[]; total: number }> {
  const repository = new AgentReportRepository(prisma);
  const [reports, total] = await Promise.all([
    repository.findAll({ page, pageSize, search }),
    repository.count({ search }),
  ]);
  return { reports, total };
}

export async function getAgentReportById({
  id,
}: {
  id: string;
}): Promise<AgentReport | null> {
  const repository = new AgentReportRepository(prisma);
  return repository.findById({ id });
}

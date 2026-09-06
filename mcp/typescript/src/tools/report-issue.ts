import {
  collectSensitiveEnvValues,
  REDACTION_AUDIT_URL,
  redactReportText,
  redactSessionJsonl,
  truncateJsonlToByteBudget,
} from "@langwatch/redaction";
import { getConfig } from "../config.js";

/** Transcripts are capped after redaction; oldest lines are dropped first. */
const MAX_SESSION_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

export interface ReportIssueParams {
  user_approved: boolean;
  title: string;
  summary?: string;
  session_content?: string;
  contact_email?: string;
  agent?: string;
}

interface RedactedReport {
  title: string;
  summary?: string;
  sessionData?: string;
  sessionTruncated: boolean;
  redactedCount: number;
}

/** Redaction runs locally, before anything leaves the machine. */
function redactReport(params: ReportIssueParams): RedactedReport {
  const envValues = collectSensitiveEnvValues(process.env);
  let redactedCount = 0;

  const titleResult = redactReportText({ text: params.title, envValues });
  redactedCount += titleResult.redactedCount;

  let summary: string | undefined;
  if (params.summary) {
    const result = redactReportText({ text: params.summary, envValues });
    summary = result.text;
    redactedCount += result.redactedCount;
  }

  let sessionData: string | undefined;
  let sessionTruncated = false;
  if (params.session_content) {
    const redacted = redactSessionJsonl({
      jsonl: params.session_content,
      envValues,
    });
    redactedCount += redacted.redactedCount;
    const truncated = truncateJsonlToByteBudget({
      jsonl: redacted.text,
      maxBytes: MAX_SESSION_BYTES,
    });
    sessionData = truncated.text;
    sessionTruncated = truncated.truncated;
  }

  return {
    title: titleResult.text,
    summary,
    sessionData,
    sessionTruncated,
    redactedCount,
  };
}

async function deliverReport(
  report: RedactedReport,
  params: ReportIssueParams,
): Promise<string> {
  const config = getConfig();
  const endpoint = config.endpoint.replace(/\/+$/, "");

  const response = await fetch(`${endpoint}/api/bug-reports`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      source: "mcp",
      kind: report.sessionData ? "full_session" : "summary",
      title: report.title,
      ...(report.summary ? { summary: report.summary } : {}),
      ...(report.sessionData
        ? { sessionData: report.sessionData, sessionTruncated: report.sessionTruncated }
        : {}),
      ...(params.agent ? { agent: params.agent } : {}),
      ...(params.contact_email ? { contactEmail: params.contact_email } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => {
    throw new Error(
      `Could not reach ${endpoint} to deliver the report. Retry in a moment; if it ` +
        "keeps failing, email support@langwatch.ai with the same content.",
    );
  });

  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `The reports endpoint answered HTTP ${response.status}: ${body}. Retry in a ` +
        "moment; if it keeps failing, email support@langwatch.ai.",
    );
  }

  const { id } = (await response.json()) as { id: string };
  return id;
}

/**
 * Sends an issue report to the LangWatch team. Deliberately does NOT require
 * an API key: the reporter may be struggling precisely because setup failed.
 * When a key is configured it only links the report to the project.
 */
export async function handleReportIssue(
  params: ReportIssueParams,
): Promise<string> {
  if (!params.user_approved) {
    throw new Error(
      "This sends a report to the LangWatch team, so the user must approve it first. " +
        'Ask the user: "Can I send this issue report to LangWatch to help them fix it?" ' +
        "If they agree, call again with user_approved=true. Secrets and personal data " +
        `are redacted locally before sending; audit the rules at ${REDACTION_AUDIT_URL}`,
    );
  }

  if (!params.summary?.trim() && !params.session_content?.trim()) {
    throw new Error(
      "Nothing to report: pass a summary (what you tried, verbatim errors, what " +
        "you had to figure out), session_content, or both.",
    );
  }

  const report = redactReport(params);
  const id = await deliverReport(report, params);

  return [
    `Report sent to the LangWatch team (${id}). Thank you!`,
    `Redacted ${report.redactedCount} sensitive value${report.redactedCount === 1 ? "" : "s"} locally before sending.`,
    ...(report.sessionTruncated
      ? ["The session content was truncated to the most recent activity to fit the upload limit."]
      : []),
    "Reports like this directly shape what gets fixed next.",
  ].join(" ");
}

import { readFileSync, statSync } from "node:fs";
import chalk from "chalk";
import { createCommandEvents } from "../telemetry/events";
import type { CommandResult } from "../utils/output";
import { getEndpoint } from "../utils/endpoint";
import {
  collectSensitiveEnvValues,
  REDACTION_AUDIT_URL,
  redactReportText,
  redactSessionJsonl,
  truncateJsonlToByteBudget,
} from "../../internal/generated/redaction/sessionReport";
import { normalizeEndpoint } from "../../internal/endpoint";

declare const __CLI_VERSION__: string;

/** Transcripts are capped after redaction; oldest lines are dropped first. */
const MAX_SESSION_BYTES = 8 * 1024 * 1024;
/** Refuse absurd inputs before reading them into memory. */
const MAX_RAW_SESSION_BYTES = 200 * 1024 * 1024;
const MAX_SUMMARY_CHARS = 200_000;
const REQUEST_TIMEOUT_MS = 60_000;

export interface ReportCommandOptions {
  userApproved?: boolean;
  summary?: string;
  summaryFile?: string;
  session?: string;
  title?: string;
  agent?: string;
  email?: string;
  endpoint?: string;
  dryRun?: boolean;
}

const cliVersion = (): string =>
  typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "dev";

/** Whitespace-only inputs fall through to the next title candidate. */
const nonEmptyTrimmed = (text: string | undefined): string | undefined => {
  const trimmed = text?.trim();
  return trimmed === "" ? undefined : trimmed;
};

/** Best-effort detection of the coding agent driving this terminal. */
export const detectAgent = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  if (env.CLAUDECODE ?? env.CLAUDE_CODE_ENTRYPOINT) return "claude-code";
  if (Object.keys(env).some((name) => name.startsWith("CODEX_"))) return "codex";
  if (env.CURSOR_TRACE_ID ?? env.CURSOR_AGENT) return "cursor";
  if (env.GEMINI_CLI) return "gemini-cli";
  return undefined;
};

export const reportCommand = async (
  options: ReportCommandOptions,
): Promise<CommandResult | void> => {
  // A dry run never sends anything, so it needs no approval: it exists
  // precisely so the agent can show the user the payload BEFORE asking.
  if (!options.userApproved && !options.dryRun) {
    throw new Error(
      [
        "This sends a report to the LangWatch team, so the user must approve it first.",
        "",
        'Ask the user: "Can I send this issue report (and optionally the session',
        'transcript) to LangWatch to help them fix it?" If they agree, re-run with',
        "--user-approved. API keys, secrets, emails and phone numbers are redacted",
        `locally before anything is sent; audit the exact rules at ${REDACTION_AUDIT_URL}`,
        "Preview the exact redacted payload first with --dry-run (no approval needed).",
      ].join("\n"),
    );
  }

  if (options.summary && options.summaryFile) {
    throw new Error("Pass either --summary or --summary-file, not both.");
  }

  let summary = options.summary;
  if (options.summaryFile) {
    try {
      summary = readFileSync(options.summaryFile, "utf8");
    } catch {
      throw new Error(`Could not read summary file: ${options.summaryFile}`);
    }
  }
  if (summary && summary.length > MAX_SUMMARY_CHARS) {
    summary = summary.slice(0, MAX_SUMMARY_CHARS);
  }

  let rawSession: string | undefined;
  if (options.session) {
    let size: number;
    try {
      size = statSync(options.session).size;
    } catch {
      throw new Error(
        `Session file not found: ${options.session}\n` +
          "Claude Code transcripts live under ~/.claude/projects/<project>/*.jsonl,\n" +
          "Codex transcripts under ~/.codex/sessions/<year>/<month>/<day>/*.jsonl.",
      );
    }
    if (size > MAX_RAW_SESSION_BYTES) {
      throw new Error(
        `Session file is ${Math.round(size / 1024 / 1024)}MB; the limit is ${Math.round(MAX_RAW_SESSION_BYTES / 1024 / 1024)}MB.`,
      );
    }
    rawSession = readFileSync(options.session, "utf8");
  }

  if (!summary?.trim() && !rawSession?.trim()) {
    throw new Error(
      [
        "Nothing to report: pass --summary/--summary-file, --session <transcript.jsonl>, or both.",
        "",
        "A good report includes what you were trying to do, what went wrong (verbatim",
        "errors), and what you had to figure out the hard way. The full session",
        "transcript is the most useful thing you can send.",
      ].join("\n"),
    );
  }

  const events = createCommandEvents({ resource: "report", verb: "send" });
  events.started("Preparing report…");

  // Redaction runs locally, before anything leaves this machine.
  const envValues = collectSensitiveEnvValues(process.env);
  let redactedCount = 0;

  if (summary) {
    const result = redactReportText({ text: summary, envValues });
    summary = result.text;
    redactedCount += result.redactedCount;
  }

  let sessionData: string | undefined;
  let sessionTruncated = false;
  if (rawSession) {
    const redacted = redactSessionJsonl({ jsonl: rawSession, envValues });
    redactedCount += redacted.redactedCount;
    const truncated = truncateJsonlToByteBudget({
      jsonl: redacted.text,
      maxBytes: MAX_SESSION_BYTES,
    });
    sessionData = truncated.text;
    sessionTruncated = truncated.truncated;
  }

  const rawTitle =
    nonEmptyTrimmed(options.title) ??
    nonEmptyTrimmed(summary?.trim().split("\n")[0]?.slice(0, 200)) ??
    "Session report";
  const titleResult = redactReportText({ text: rawTitle, envValues });
  redactedCount += titleResult.redactedCount;
  const title = titleResult.text;

  const payload = {
    source: "cli" as const,
    kind: sessionData ? ("full_session" as const) : ("summary" as const),
    title,
    ...(summary ? { summary } : {}),
    ...(sessionData ? { sessionData, sessionTruncated } : {}),
    agent: options.agent ?? detectAgent(),
    ...(options.email ? { contactEmail: options.email } : {}),
    cliVersion: cliVersion(),
  };

  if (options.dryRun) {
    events.completed({ message: "Dry run: nothing sent" });
    return {
      data: { dryRun: true, redactedCount, payload },
      table: () => {
        console.log(chalk.blue("Dry run: this is what would be sent (nothing was sent)"));
        console.log(
          chalk.gray(
            `Redacted ${redactedCount} sensitive value${redactedCount === 1 ? "" : "s"} locally. Audit the rules: ${REDACTION_AUDIT_URL}`,
          ),
        );
        console.log(JSON.stringify(payload, null, 2));
      },
    };
  }

  const endpoint = normalizeEndpoint(options.endpoint ?? getEndpoint());
  const apiKey = process.env.LANGWATCH_API_KEY?.trim();

  let response: Response;
  try {
    response = await fetch(`${endpoint}/api/bug-reports`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    events.failed({ error, message: "Could not reach LangWatch" });
    throw new Error(
      `Could not reach ${endpoint} to deliver the report. Check the connection and retry;` +
        " if it keeps failing, email support@langwatch.ai with the same content.",
    );
  }

  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 500);
    events.failed({
      error: new Error(`HTTP ${response.status}`),
      message: "Report rejected",
    });
    throw new Error(
      `The reports endpoint answered HTTP ${response.status}: ${body}\n` +
        "Retry in a moment; if it keeps failing, email support@langwatch.ai.",
    );
  }

  const { id } = (await response.json()) as { id: string };
  events.completed({ message: "Report sent" });

  return {
    data: {
      id,
      kind: payload.kind,
      redactedCount,
      sessionTruncated,
    },
    table: () => {
      console.log(chalk.green(`✓ Report sent to the LangWatch team (${id})`));
      console.log(
        chalk.gray(
          `  Redacted ${redactedCount} sensitive value${redactedCount === 1 ? "" : "s"} locally before sending.`,
        ),
      );
      if (sessionTruncated) {
        console.log(
          chalk.gray(
            "  The transcript was truncated to the most recent activity to fit the upload limit.",
          ),
        );
      }
      console.log(
        chalk.gray("  Thank you! Reports like this directly shape what gets fixed next."),
      );
    },
  };
};

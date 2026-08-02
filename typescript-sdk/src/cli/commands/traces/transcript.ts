import { scopedApiKey } from "@/internal/credentialContext";
import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import {
  printResult,
  type RawOutputFlags,
} from "../../utils/output";
import { createCommandEvents } from "../../telemetry/events";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";

interface TranscriptEntry {
  kind: string;
  atMs: number;
  text?: string | null;
  chars?: number;
  model?: string | null;
  tokens?: number;
  costUsd?: number;
  name?: string | null;
  [key: string]: unknown;
}

interface TranscriptDocument {
  agent: string;
  sessionId: string | null;
  entries: TranscriptEntry[];
  totals: {
    modelCalls: number;
    toolCalls: number;
    tokens: number;
    costUsd: number;
  };
  subAgents: Array<{ agentId: string; toolCalls: number }>;
}

export const transcriptTraceCommand = async (
  traceId: string,
  options: RawOutputFlags,
): Promise<void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();
  const spinner = createSpinner("Fetching transcript...").start();
  const events = createCommandEvents({ resource: "trace", verb: "get" });

  let doc: TranscriptDocument;
  try {
    events.started("Fetching transcript…");

    const response = await fetch(
      `${endpoint}/api/traces/${encodeURIComponent(traceId)}/transcript`,
      { headers: buildAuthHeaders({ apiKey }) },
    );

    if (!response.ok) {
      const message = await formatFetchError(response);
      events.failed({
        error: Object.assign(new Error(message), { status: response.status }),
        message: "Trace transcript fetch failed",
      });
      await events.flush();
      failSpinner({
        spinner,
        error: new Error(message),
        action: "fetch transcript",
      });
      process.exit(1);
    }

    doc = (await response.json()) as TranscriptDocument;
    spinner.succeed(
      `${doc.entries.length} transcript entr${doc.entries.length === 1 ? "y" : "ies"} (${doc.agent})`,
    );
  } catch (error) {
    events.failed({ error, message: "Trace transcript fetch failed" });
    await events.flush();
    failSpinner({ spinner, error, action: "fetch transcript" });
    process.exit(1);
    return;
  }

  await printResult(doc, {
    ...options,
    table: () => renderTranscript(doc),
  });

  events.completed({
    count: doc.entries.length,
    total: doc.entries.length,
    message: `Printed ${doc.entries.length} transcript entr${doc.entries.length === 1 ? "y" : "ies"}`,
  });
  await events.flush();
};

/** Human rendering: one line per entry, economics dimmed, prompts loud. */
const renderTranscript = (doc: TranscriptDocument): void => {
  console.log();
  for (const entry of doc.entries) {
    console.log(renderEntry(entry));
  }
  console.log();
  console.log(
    chalk.gray(
      `${doc.totals.modelCalls} model calls · ${doc.totals.toolCalls} tool calls · ` +
        `${doc.totals.tokens.toLocaleString()} tokens · $${doc.totals.costUsd.toFixed(2)}`,
    ),
  );
};

const renderEntry = (entry: TranscriptEntry): string => {
  const time = new Date(entry.atMs).toISOString().slice(11, 19);
  const stamp = chalk.gray(time);

  switch (entry.kind) {
    case "system_prompt":
      return `${stamp} ${chalk.gray(`[session context: ${entry.chars?.toLocaleString() ?? "?"} chars]`)}`;
    case "user_prompt":
      return `${stamp} ${chalk.cyan(`> ${entry.text ?? ""}`)}`;
    case "assistant_message":
      return `${stamp} ${entry.text ?? ""}`;
    case "model_call":
      return `${stamp} ${chalk.gray(
        `· model call ${entry.model ?? ""} ${entry.tokens?.toLocaleString() ?? "?"} tokens` +
          (entry.costUsd != null ? ` $${entry.costUsd.toFixed(4)}` : ""),
      )}`;
    default: {
      const label = [entry.kind, entry.name ?? entry.text ?? ""]
        .filter(Boolean)
        .join(" ");
      return `${stamp} ${chalk.gray(`· ${label}`)}`;
    }
  }
};

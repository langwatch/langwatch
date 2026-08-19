import chalk from "chalk";
import { z } from "zod";
import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { scopedApiKey } from "@/internal/credentialContext";
import { createCommandEvents } from "../../telemetry/events";
import { resolveCredentials } from "../../utils/apiKey";
import { clockTime, dayHeading, localDay } from "../../utils/event-clock";
import { formatFetchError } from "../../utils/formatFetchError";
import { printResult, type RawOutputFlags } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/** Bound the request so a quiet socket cannot hold the CLI open forever. */
const REQUEST_TIMEOUT_MS = 60_000;

const transcriptEntrySchema = z.looseObject({
  kind: z.string(),
  atMs: z.number(),
  text: z.string().nullable().optional(),
  chars: z.number().optional(),
  model: z.string().nullable().optional(),
  tokens: z.number().optional(),
  costUsd: z.number().optional(),
  name: z.string().nullable().optional(),
});

const transcriptDocumentSchema = z.object({
  agent: z.string(),
  sessionId: z.string().nullable(),
  entries: z.array(transcriptEntrySchema),
  totals: z.object({
    modelCalls: z.number(),
    toolCalls: z.number(),
    tokens: z.number(),
    costUsd: z.number(),
  }),
  subAgents: z.array(
    z.looseObject({ agentId: z.string(), toolCalls: z.number() }),
  ),
});

type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;
type TranscriptDocument = z.infer<typeof transcriptDocumentSchema>;

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
      {
        headers: buildAuthHeaders({ apiKey }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
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

    doc = transcriptDocumentSchema.parse(await response.json());
    spinner.succeed(
      `${plural(doc.entries.length, "transcript entry", "transcript entries")} (${doc.agent})`,
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
    message: `Printed ${plural(doc.entries.length, "transcript entry", "transcript entries")}`,
  });
  await events.flush();
};

const plural = (count: number, singular: string, pluralForm?: string): string =>
  `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;

/** Human rendering: one line per entry, economics dimmed, prompts loud. */
const renderTranscript = (doc: TranscriptDocument): void => {
  console.log();
  let day = "";
  for (const entry of doc.entries) {
    const entryDay = localDay(entry.atMs);
    if (entryDay !== day) {
      day = entryDay;
      console.log(chalk.gray(dayHeading(entry.atMs)));
    }
    console.log(renderEntry(entry));
  }
  console.log();
  console.log(
    chalk.gray(
      `${plural(doc.totals.modelCalls, "model call")} · ${plural(doc.totals.toolCalls, "tool call")} · ` +
        `${doc.totals.tokens.toLocaleString()} tokens · $${doc.totals.costUsd.toFixed(2)}`,
    ),
  );
};

const renderEntry = (entry: TranscriptEntry): string => {
  const stamp = chalk.gray(clockTime(entry.atMs));

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

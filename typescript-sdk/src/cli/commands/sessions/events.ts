import { scopedApiKey } from "@/internal/credentialContext";
import chalk from "chalk";
import { z } from "zod";
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

/** Bound each page request so a quiet socket cannot hold the CLI open forever. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Server page ceiling; larger limits are satisfied by cursor paging. */
const SERVER_PAGE_CAP = 1000;

const sessionEventSchema = z
  .object({
    timeUnixMs: z.number(),
    recordId: z.string(),
    eventKind: z.string(),
    promptId: z.string().optional(),
    querySource: z.string().optional(),
    agentType: z.string().optional(),
    model: z.string().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    cacheReadTokens: z.number().optional(),
    cacheCreationTokens: z.number().optional(),
    costUsd: z.number().optional(),
    durationMs: z.number().optional(),
    preTokens: z.number().optional(),
    postTokens: z.number().optional(),
    compactionTrigger: z.string().optional(),
    toolName: z.string().optional(),
    rateLimitKind: z.string().optional(),
    totalTokens: z.number().optional(),
  })
  .passthrough();

const sessionEventsPageSchema = z.object({
  events: z.array(sessionEventSchema),
  nextCursor: z.string().nullable(),
});

type SessionEvent = z.infer<typeof sessionEventSchema>;

export const sessionEventsCommand = async (
  sessionId: string,
  options: {
    kinds?: string;
    limit?: string;
    from?: string;
    to?: string;
  } & RawOutputFlags,
): Promise<void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const limit = options.limit ? Number(options.limit) : 500;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    console.error(
      chalk.red(
        `Error: --limit must be a positive whole number, got "${options.limit}"`,
      ),
    );
    process.exit(1);
  }

  const spinner = createSpinner("Fetching session events...").start();
  const events = createCommandEvents({ resource: "trace", verb: "search" });

  const collected: SessionEvent[] = [];
  let nextCursor: string | null = null;
  try {
    events.started("Fetching session events…");

    let cursor: string | null = null;
    for (;;) {
      const pageSize = Math.min(limit - collected.length, SERVER_PAGE_CAP);
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (options.kinds) params.set("kinds", options.kinds);
      if (options.from) params.set("from", String(new Date(options.from).getTime()));
      if (options.to) params.set("to", String(new Date(options.to).getTime()));
      if (cursor) params.set("cursor", cursor);

      const response = await fetch(
        `${endpoint}/api/coding-agent/sessions/${encodeURIComponent(sessionId)}/events?${params}`,
        {
          headers: buildAuthHeaders({ apiKey }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        const message = await formatFetchError(response);
        events.failed({
          error: Object.assign(new Error(message), { status: response.status }),
          message: "Session events fetch failed",
        });
        await events.flush();
        failSpinner({
          spinner,
          error: new Error(message),
          action: "fetch session events",
        });
        process.exit(1);
      }

      const page = sessionEventsPageSchema.parse(await response.json());
      collected.push(...page.events.slice(0, limit - collected.length));
      nextCursor = page.nextCursor;

      spinner.text = `Fetching session events... ${collected.length.toLocaleString()} fetched`;
      if (!page.nextCursor || page.events.length === 0 || collected.length >= limit) {
        break;
      }
      cursor = page.nextCursor;
    }

    spinner.succeed(
      `${collected.length.toLocaleString()} session event${collected.length === 1 ? "" : "s"}`,
    );
  } catch (error) {
    events.failed({ error, message: "Session events fetch failed" });
    await events.flush();
    failSpinner({ spinner, error, action: "fetch session events" });
    process.exit(1);
    return;
  }

  await printResult(
    { events: collected, nextCursor },
    {
      ...options,
      table: () => renderEvents(collected),
    },
  );

  events.completed({
    count: collected.length,
    total: collected.length,
    message: `Returned ${collected.length} session event${collected.length === 1 ? "" : "s"}`,
  });
  await events.flush();
};

const renderEvents = (rows: SessionEvent[]): void => {
  console.log();
  for (const event of rows) {
    console.log(renderEvent(event));
  }
  if (rows.length === 0) {
    console.log(chalk.gray("No session events found."));
  }
  console.log();
};

const renderEvent = (event: SessionEvent): string => {
  const time = new Date(event.timeUnixMs).toISOString().slice(11, 19);
  const stamp = chalk.gray(time);

  switch (event.eventKind) {
    case "model_call": {
      const context =
        (event.cacheReadTokens ?? 0) +
        (event.cacheCreationTokens ?? 0) +
        (event.inputTokens ?? 0);
      const lane = event.agentType ? ` [${event.agentType}]` : "";
      return `${stamp} model call${lane} ${event.model ?? ""} context=${context.toLocaleString()} output=${(event.outputTokens ?? 0).toLocaleString()}${event.costUsd != null ? ` $${event.costUsd.toFixed(4)}` : ""}`;
    }
    case "compaction":
      return `${stamp} ${chalk.yellow(
        `compaction ${event.compactionTrigger ?? ""} ${(event.preTokens ?? 0).toLocaleString()} tokens to ${(event.postTokens ?? 0).toLocaleString()} tokens`,
      )}`;
    case "rate_limit":
      return `${stamp} ${chalk.red(`rate limit (${event.rateLimitKind ?? ""})`)}`;
    case "subagent_completed":
      return `${stamp} subagent completed [${event.agentType ?? ""}] ${(event.totalTokens ?? 0).toLocaleString()} tokens`;
    case "tool_result":
    case "tool_decision":
      return `${stamp} ${chalk.gray(`${event.eventKind} ${event.toolName ?? ""}`)}`;
    default:
      return `${stamp} ${chalk.gray(event.eventKind)}`;
  }
};

import chalk from "chalk";
import { z } from "zod";
import { buildAuthHeaders } from "@/internal/api/auth";
import { createCommandEvents } from "../../telemetry/events";
import { resolveCredentials } from "../../utils/apiKey";
import { clockTime, dayHeading, localDay } from "../../utils/event-clock";
import { formatFetchError } from "../../utils/formatFetchError";
import { printResult, type RawOutputFlags } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/** Bound each page request so a quiet socket cannot hold the CLI open forever. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Server page ceiling; larger limits are satisfied by cursor paging. */
const SERVER_PAGE_CAP = 1000;

/** Events returned when `--limit` is not given. */
const DEFAULT_LIMIT = 500;

const sessionEventSchema = z.looseObject({
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
  rateLimitCarrier: z.string().optional(),
  totalTokens: z.number().optional(),
});

const sessionEventsPageSchema = z.object({
  events: z.array(sessionEventSchema),
  nextCursor: z.string().nullable(),
});

type SessionEvent = z.infer<typeof sessionEventSchema>;

/** `--limit`, or the default. Exits with a clear message when unusable. */
const parseLimitOption = (raw: string | undefined): number => {
  const limit = raw ? Number(raw) : DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    console.error(
      chalk.red(`Error: --limit must be a positive whole number, got "${raw}"`),
    );
    process.exit(1);
  }
  return limit;
};

/**
 * `--from`/`--to` as epoch ms. Both spellings the help promises are accepted:
 * an ISO string and a bare epoch-ms integer. Anything else stops the command
 * here, because `new Date(...).getTime()` on unparsable input is NaN and the
 * server would receive the literal string "NaN" as the bound.
 */
const parseTimeOption = (
  raw: string | undefined,
  flag: string,
): number | undefined => {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  const parsed = /^-?\d+$/.test(trimmed)
    ? Number(trimmed)
    : new Date(trimmed).getTime();
  if (!Number.isFinite(parsed)) {
    console.error(
      chalk.red(`Error: ${flag} must be an ISO date or epoch ms, got "${raw}"`),
    );
    process.exit(1);
  }
  return parsed;
};

/**
 * Walk the server's cursor until `limit` events are in hand or the session
 * runs out. Throws on a non-OK response so the caller owns every failure
 * path, spinner and telemetry included.
 */
const fetchAllSessionEvents = async ({
  sessionId,
  endpoint,
  apiKey,
  limit,
  kinds,
  fromMs,
  toMs,
  onProgress,
}: {
  sessionId: string;
  endpoint: string;
  apiKey: string;
  limit: number;
  kinds?: string;
  fromMs?: number;
  toMs?: number;
  onProgress: (fetched: number) => void;
}): Promise<{ events: SessionEvent[]; nextCursor: string | null }> => {
  const collected: SessionEvent[] = [];
  let nextCursor: string | null = null;
  let cursor: string | null = null;

  for (;;) {
    const pageSize = Math.min(limit - collected.length, SERVER_PAGE_CAP);
    const params = new URLSearchParams({ limit: String(pageSize) });
    if (kinds) params.set("kinds", kinds);
    if (fromMs !== undefined) params.set("from", String(fromMs));
    if (toMs !== undefined) params.set("to", String(toMs));
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(
      `${endpoint}/api/coding-agent/sessions/${encodeURIComponent(sessionId)}/events?${params}`,
      {
        headers: buildAuthHeaders({ apiKey }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw Object.assign(new Error(await formatFetchError(response)), {
        status: response.status,
      });
    }

    const page = sessionEventsPageSchema.parse(await response.json());
    collected.push(...page.events.slice(0, limit - collected.length));
    nextCursor = page.nextCursor;
    onProgress(collected.length);

    if (
      !page.nextCursor ||
      page.events.length === 0 ||
      collected.length >= limit
    ) {
      break;
    }
    cursor = page.nextCursor;
  }

  return { events: collected, nextCursor };
};

export const sessionEventsCommand = async (
  sessionId: string,
  options: {
    kinds?: string;
    limit?: string;
    from?: string;
    to?: string;
  } & RawOutputFlags,
): Promise<void> => {
  const { apiKey, endpoint } = await resolveCredentials();

  const limit = parseLimitOption(options.limit);
  const fromMs = parseTimeOption(options.from, "--from");
  const toMs = parseTimeOption(options.to, "--to");

  const spinner = createSpinner("Fetching session events...").start();
  const telemetry = createCommandEvents({
    resource: "session",
    verb: "events",
  });

  let collected: SessionEvent[] = [];
  let nextCursor: string | null = null;
  try {
    telemetry.started("Fetching session events…");
    const page = await fetchAllSessionEvents({
      sessionId,
      endpoint,
      apiKey,
      limit,
      kinds: options.kinds,
      fromMs,
      toMs,
      onProgress: (fetched) => {
        spinner.text = `Fetching session events... ${fetched.toLocaleString()} fetched`;
      },
    });
    collected = page.events;
    nextCursor = page.nextCursor;

    spinner.succeed(
      `${collected.length.toLocaleString()} session event${collected.length === 1 ? "" : "s"}`,
    );
  } catch (error) {
    telemetry.failed({ error, message: "Session events fetch failed" });
    await telemetry.flush();
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

  telemetry.completed({
    count: collected.length,
    total: collected.length,
    message: `Returned ${collected.length} session event${collected.length === 1 ? "" : "s"}`,
  });
  await telemetry.flush();
};

const renderEvents = (rows: SessionEvent[]): void => {
  console.log();
  let day = "";
  for (const event of rows) {
    const eventDay = localDay(event.timeUnixMs);
    if (eventDay !== day) {
      day = eventDay;
      console.log(chalk.gray(dayHeading(event.timeUnixMs)));
    }
    console.log(renderEvent(event));
  }
  if (rows.length === 0) {
    console.log(chalk.gray("No session events found."));
  }
  console.log();
};

const renderEvent = (event: SessionEvent): string => {
  const stamp = chalk.gray(clockTime(event.timeUnixMs));

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
      return `${stamp} ${chalk.red(`rate limit (${event.rateLimitCarrier ?? ""})`)}`;
    case "subagent_completed":
      return `${stamp} subagent completed [${event.agentType ?? ""}] ${(event.totalTokens ?? 0).toLocaleString()} tokens`;
    case "tool_result":
    case "tool_decision":
      return `${stamp} ${chalk.gray(`${event.eventKind} ${event.toolName ?? ""}`)}`;
    default:
      return `${stamp} ${chalk.gray(event.eventKind)}`;
  }
};

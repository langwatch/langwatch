import { setTimeout as wait } from "node:timers/promises";

import chalk from "chalk";

import { readCommandError, reportCommandError } from "@/cli/utils/errorOutput";
import { getEventsForSource, type ActivityEventDetailRow } from "@/cli/utils/governance/cli-api";
import { loadConfig, isLoggedIn } from "@/cli/utils/governance/config";

/**
 * Stream OCSF events for an IngestionSource. --follow polls every 3s,
 * deduplicates by eventId.
 */
export async function ingestTailCommand(
  sourceId: string,
  options: { limit?: number; follow?: boolean; json?: boolean },
): Promise<void> {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    process.stderr.write("Not logged in. Run `langwatch login --device` first.\n");
    process.exit(1);
  }

  const limit = options.limit ?? 50;

  let initial: ActivityEventDetailRow[];
  try {
    initial = await getEventsForSource(cfg, sourceId, { limit });
  } catch (err) {
    reportCommandError({ error: err, format: options.json ? "json" : undefined });
    process.exit(1);
  }

  printInitialEvents({ initial, json: options.json === true });

  if (!options.follow) return;

  await followEvents({ cfg, sourceId, initial, json: options.json === true });
}

/**
 * Dedup filter for polling loop: returns new events (by timestamp + seen set)
 * in chronological order. Exported for unit testing.
 */
export function pickFreshEvents(
  next: readonly ActivityEventDetailRow[],
  state: { cursorIso: string; seen: ReadonlySet<string> },
): ActivityEventDetailRow[] {
  return next
    .filter(
      (e) =>
        e.eventTimestampIso > state.cursorIso ||
        (e.eventTimestampIso === state.cursorIso && !state.seen.has(e.eventId)),
    )
    .slice()
    .reverse();
}

/**
 * Render event row for human output. Pure (no I/O). Cost and token counts are
 * meta cells (suppressed if zero).
 */
export function formatEventLine(e: ActivityEventDetailRow): string {
  const ts = chalk.gray(e.eventTimestampIso);
  const evt = chalk.cyan(e.eventType);
  const action = chalk.white(e.action);
  const target = chalk.magenta(e.target);
  const cost = e.costUsd > 0 ? chalk.yellow(`$${e.costUsd.toFixed(4)}`) : "";
  const tokens =
    e.tokensInput || e.tokensOutput ? chalk.gray(`${e.tokensInput}/${e.tokensOutput} tok`) : "";
  const meta = [cost, tokens].filter(Boolean).join(" ");
  return `${ts}  ${evt}  ${action} → ${target}  ${meta}`;
}

function printEventLine(e: ActivityEventDetailRow): void {
  console.log(formatEventLine(e));
}

function printInitialEvents({
  initial,
  json,
}: {
  initial: ActivityEventDetailRow[];
  json: boolean;
}): void {
  if (json) {
    console.log(JSON.stringify(initial, null, 2));
  } else {
    if (initial.length === 0) {
      console.log(
        chalk.gray(
          "No events for this source yet. Once your upstream platform " +
            "starts sending OTel/audit logs to /api/ingest/* with the " +
            "source's bearer secret, events will land here.",
        ),
      );
    } else {
      // Display oldest-first so a tail-like reader sees the chronology.
      // (eventsForSource returns DESC; reverse for printing.)
      const oldestFirst = [...initial].reverse();
      for (const e of oldestFirst) {
        printEventLine(e);
      }
    }
  }
}

/** Polls every 3s and prints each event not seen yet, until interrupted. */
async function followEvents({
  cfg,
  sourceId,
  initial,
  json,
}: {
  cfg: ReturnType<typeof loadConfig>;
  sourceId: string;
  initial: ActivityEventDetailRow[];
  json: boolean;
}): Promise<void> {
  // Poll every 3s. Track the most recent eventTimestamp + eventIds
  // we've already printed within the same second so we don't dup
  // events that share a timestamp.
  let cursorIso = initial[0]?.eventTimestampIso ?? new Date().toISOString();
  const seen = new Set<string>(initial.map((e) => e.eventId));
  process.on("SIGINT", () => {
    process.stderr.write(chalk.gray("\n^C — exiting tail\n"));
    process.exit(0);
  });
  for (;;) {
    await wait(3000);
    let next: ActivityEventDetailRow[];
    try {
      // Query without beforeIso — we want the MOST RECENT, then
      // filter in-memory to anything newer than cursorIso OR a new
      // eventId at the cursorIso boundary.
      next = await getEventsForSource(cfg, sourceId, { limit: 50 });
    } catch (err) {
      // Transient errors shouldn't kill the follow; print + retry. This is a
      // deliberate non-terminal warning (the loop continues), so it stays a
      // one-line yellow write rather than the full reportCommandError block —
      // but the message is read through the same handled-error reader (scrubbed,
      // domain-aware) as the terminal path.
      const msg = readCommandError(err).message;
      process.stderr.write(chalk.yellow(`warn: ${msg} (retrying)\n`));
      continue;
    }
    const fresh = pickFreshEvents(next, { cursorIso, seen });
    for (const e of fresh) {
      if (json) {
        console.log(JSON.stringify(e));
      } else {
        printEventLine(e);
      }
      seen.add(e.eventId);
      if (e.eventTimestampIso > cursorIso) cursorIso = e.eventTimestampIso;
    }
  }
}

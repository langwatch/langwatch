import { setTimeout as wait } from "node:timers/promises";
import chalk from "chalk";
import { loadConfig, isLoggedIn } from "@/cli/utils/governance/config";
import {
  getEventsForSource,
  GovernanceCliError,
  ActivityEventDetailRow,
} from "@/cli/utils/governance/cli-api";

/**
 * `langwatch ingest tail <sourceId> [--limit N] [--follow] [--json]`
 *
 * Stream recent OCSF-normalised events for an IngestionSource. Wraps
 * the same `eventsForSource` query the per-source detail page uses,
 * so what you see in `tail` and what you see in the web UI are
 * guaranteed identical.
 *
 * --follow polls every 3s for new events (cursor-paginated by
 * eventTimestamp DESC); deduplicates by eventId so replays don't
 * print twice. Ctrl-C exits cleanly.
 */
export async function ingestTailCommand(
  sourceId: string,
  options: { limit?: number; follow?: boolean; json?: boolean },
): Promise<void> {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    process.stderr.write(
      "Not logged in — run `langwatch login --device` first\n",
    );
    process.exit(1);
  }

  const limit = options.limit ?? 50;

  let initial: ActivityEventDetailRow[];
  try {
    initial = await getEventsForSource(cfg, sourceId, { limit });
  } catch (err) {
    if (err instanceof GovernanceCliError) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(err.status === 404 ? 1 : 1);
    }
    process.stderr.write(`Error: ${String(err)}\n`);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(initial, null, 2));
    if (!options.follow) return;
  } else {
    if (initial.length === 0) {
      console.log(
        chalk.gray(
          "No events for this source yet. Once your upstream platform " +
            "starts sending OTel/audit logs to /api/ingest/* with the " +
            "source's bearer secret, events will land here.",
        ),
      );
      if (!options.follow) return;
    } else {
      // Display oldest-first so a tail-like reader sees the chronology.
      // (eventsForSource returns DESC; reverse for printing.)
      const oldestFirst = [...initial].reverse();
      for (const e of oldestFirst) {
        printEventLine(e);
      }
    }
  }

  if (!options.follow) return;

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
      // Transient errors shouldn't kill the follow; print + retry.
      const msg = err instanceof GovernanceCliError ? err.message : String(err);
      process.stderr.write(chalk.yellow(`warn: ${msg} (retrying)\n`));
      continue;
    }
    const fresh = pickFreshEvents(next, { cursorIso, seen });
    for (const e of fresh) {
      if (options.json) {
        console.log(JSON.stringify(e));
      } else {
        printEventLine(e);
      }
      seen.add(e.eventId);
      if (e.eventTimestampIso > cursorIso) cursorIso = e.eventTimestampIso;
    }
  }
}

/**
 * Pure dedup filter for the --follow polling loop. Given the latest
 * batch from the server (DESC by eventTimestamp) and the current
 * `(cursorIso, seen)` watermark, returns the events that are new
 * AND have not yet been printed, in chronological (oldest-first) order.
 *
 * Two paths produce a "new" event:
 *   1. eventTimestampIso strictly greater than cursorIso.
 *   2. eventTimestampIso equal to cursorIso AND eventId not in `seen`
 *      — handles multiple events that share the same second-resolution
 *      timestamp on the server's clock.
 *
 * Exported for unit testing; the follow loop owns the mutable state
 * (Set + cursor) and advances them after each printed row.
 */
export function pickFreshEvents(
  next: readonly ActivityEventDetailRow[],
  state: { cursorIso: string; seen: ReadonlySet<string> },
): ActivityEventDetailRow[] {
  return next
    .filter(
      (e) =>
        e.eventTimestampIso > state.cursorIso ||
        (e.eventTimestampIso === state.cursorIso &&
          !state.seen.has(e.eventId)),
    )
    .slice()
    .reverse();
}

/**
 * Renders a single event row for the human (non-JSON) output mode.
 * Pure — no I/O — so it can be unit-tested by capturing stdout via
 * a spy or by calling `formatEventLine` directly.
 *
 * Cost is suppressed when ≤ 0 (no upstream cost attribute), tokens
 * are suppressed when both counts are zero. Both fields are rendered
 * as separate trailing meta cells separated by a single space.
 */
export function formatEventLine(e: ActivityEventDetailRow): string {
  const ts = chalk.gray(e.eventTimestampIso);
  const evt = chalk.cyan(e.eventType);
  const action = chalk.white(e.action);
  const target = chalk.magenta(e.target);
  const cost = e.costUsd > 0 ? chalk.yellow(`$${e.costUsd.toFixed(4)}`) : "";
  const tokens =
    e.tokensInput || e.tokensOutput
      ? chalk.gray(`${e.tokensInput}/${e.tokensOutput} tok`)
      : "";
  const meta = [cost, tokens].filter(Boolean).join(" ");
  return `${ts}  ${evt}  ${action} → ${target}  ${meta}`;
}

function printEventLine(e: ActivityEventDetailRow): void {
  console.log(formatEventLine(e));
}

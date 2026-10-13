import { setTimeout as wait } from "node:timers/promises";

import chalk from "chalk";

import { reportCommandError } from "@/cli/utils/errorOutput";
import { listIngestionSources } from "@/cli/utils/governance/cli-api";
import { loadConfig, isLoggedIn } from "@/cli/utils/governance/config";
import { normalizeEndpoint } from "@/internal/endpoint";

/**
 * `langwatch ingest list [--all] [--json]`: read-only enumeration of the
 * org's IngestionSources, mirroring the `/governance/ingestion-sources`
 * page. Same multi-tenant guard as the web UI (device-flow Bearer token).
 */
export async function ingestListCommand(options: { all?: boolean; json?: boolean }): Promise<void> {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    process.stderr.write("Not logged in. Run `langwatch login --device` first.\n");
    process.exit(1);
  }

  let sources;
  try {
    sources = await listIngestionSources(cfg, { includeArchived: !!options.all });
  } catch (err) {
    reportCommandError({ error: err, format: options.json ? "json" : undefined });
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(sources, null, 2));
    return;
  }

  if (sources.length === 0) {
    console.log(
      chalk.gray(
        "No ingestion sources yet. Open the admin UI at " +
          `${normalizeEndpoint(cfg.control_plane_url)}/governance/ingestion-sources` +
          " to connect your first source.",
      ),
    );
    return;
  }

  // Stable formatted table. No external table dep — keep deps tight.

  const headerRow = ["NAME", "TYPE", "STATUS", "LAST EVENT"];
  const rows: string[][] = [headerRow];
  for (const s of sources) {
    const lastEvent =
      s.lastEventAt === null ? chalk.gray("—") : humanRelative(new Date(s.lastEventAt));
    const archivedTag = s.archivedAt ? chalk.gray(" [archived]") : "";
    rows.push([s.name + archivedTag, s.sourceType, colorStatus(s.status), lastEvent]);
  }
  printTable(rows);

  // Tiny await to flush stdout cleanly when piping into less etc.
  await wait(0);
}

function colorStatus(status: string): string {
  switch (status) {
    case "active":
      return chalk.green(status);
    case "awaiting_first_event":
      return chalk.yellow(status);
    case "archived":
      return chalk.gray(status);
    default:
      return status;
  }
}

/**
 * Renders a relative timestamp like "5m ago" for the LAST EVENT column,
 * falling back to the ISO string for future timestamps (clock drift), since
 * "in 5 minutes" would confuse a "last event" context.
 */
export function humanRelative(d: Date, now: number = Date.now()): string {
  const ms = now - d.getTime();
  if (ms < 0) return d.toISOString();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

/**
 * Build fixed-width table, stripping ANSI codes for accurate column widths.
 * Returns formatted string, not stdout (testable, controlled output).
 */
export function buildTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths = rows[0]!.map((_, i) =>
    rows.reduce((max, r) => Math.max(max, stripAnsi(r[i] ?? "").length), 0),
  );
  const lines: string[] = [];
  for (const row of rows) {
    const padded = row.map((cell, i) => {
      const visibleLen = stripAnsi(cell).length;
      return cell + " ".repeat(Math.max(0, widths[i]! - visibleLen));
    });
    lines.push(padded.join("  "));
  }
  return lines.join("\n");
}

function printTable(rows: string[][]): void {
  const out = buildTable(rows);
  if (out) console.log(out);
}

/** The SGR introducer, built from a char code so no control character sits in a regex literal. */
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function stripAnsi(s: string): string {
  // Strip ANSI codes from chalk output for column-width math
  return s.replace(ANSI_SGR, "");
}

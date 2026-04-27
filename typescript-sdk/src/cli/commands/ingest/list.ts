import { setTimeout as wait } from "node:timers/promises";
import chalk from "chalk";
import { loadConfig, isLoggedIn } from "@/cli/utils/governance/config";
import {
  listIngestionSources,
  GovernanceCliError,
} from "@/cli/utils/governance/cli-api";

/**
 * `langwatch ingest list [--all] [--json]`
 *
 * Read-only enumeration of the org's IngestionSources, mirroring the
 * `/settings/governance/ingestion-sources` list page for ops folks
 * who live in terminal. Same multi-tenant guard as the web UI
 * (org-scoped via the device-flow Bearer token).
 */
export async function ingestListCommand(options: {
  all?: boolean;
  json?: boolean;
}): Promise<void> {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    process.stderr.write(
      "Not logged in — run `langwatch login --device` first\n",
    );
    process.exit(1);
  }

  let sources;
  try {
    sources = await listIngestionSources(cfg, { includeArchived: !!options.all });
  } catch (err) {
    if (err instanceof GovernanceCliError) {
      process.stderr.write(`Error: ${err.message}\n`);
    } else {
      process.stderr.write(`Error: ${String(err)}\n`);
    }
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
          `${cfg.control_plane_url.replace(/\/+$/, "")}/settings/governance/ingestion-sources` +
          " to connect your first source.",
      ),
    );
    return;
  }

  // Stable formatted table. No external table dep — keep deps tight.
  const cols: Array<keyof (typeof sources)[number]> = [
    "name",
    "sourceType",
    "status",
    "lastEventAt",
  ];
  const headerRow = ["NAME", "TYPE", "STATUS", "LAST EVENT"];
  const rows: string[][] = [headerRow];
  for (const s of sources) {
    const lastEvent =
      s.lastEventAt === null
        ? chalk.gray("—")
        : humanRelative(new Date(s.lastEventAt));
    const archivedTag = s.archivedAt ? chalk.gray(" [archived]") : "";
    rows.push([
      s.name + archivedTag,
      s.sourceType,
      colorStatus(s.status),
      lastEvent,
    ]);
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

function humanRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
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

function printTable(rows: string[][]): void {
  if (rows.length === 0) return;
  const widths = rows[0]!.map((_, i) =>
    rows.reduce((max, r) => Math.max(max, stripAnsi(r[i] ?? "").length), 0),
  );
  for (const row of rows) {
    const padded = row.map((cell, i) => {
      const visibleLen = stripAnsi(cell).length;
      return cell + " ".repeat(Math.max(0, widths[i]! - visibleLen));
    });
    console.log(padded.join("  "));
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

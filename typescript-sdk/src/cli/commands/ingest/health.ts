import chalk from "chalk";
import { loadConfig, isLoggedIn } from "@/cli/utils/governance/config";
import {
  getSourceHealth,
  GovernanceCliError,
} from "@/cli/utils/governance/cli-api";

/**
 * `langwatch ingest health <sourceId> [--json]`
 *
 * One-shot health snapshot for an IngestionSource: events received in
 * the last 24h / 7d / 30d, plus the timestamp of the most recent
 * successful event. Wraps `sourceHealthMetrics`, the same query the
 * per-source detail page's metric strip uses.
 */
export async function ingestHealthCommand(
  sourceId: string,
  options: { json?: boolean },
): Promise<void> {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    process.stderr.write(
      "Not logged in — run `langwatch login --device` first\n",
    );
    process.exit(1);
  }

  let result;
  try {
    result = await getSourceHealth(cfg, sourceId);
  } catch (err) {
    const msg = err instanceof GovernanceCliError ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { source, health } = result;
  console.log(
    `${chalk.bold(source.name)}  ${chalk.gray("(" + source.id + ")")}`,
  );
  console.log(`Status:        ${colorStatus(source.status)}`);
  console.log(`Events (24h):  ${health.events24h}`);
  console.log(`Events (7d):   ${health.events7d}`);
  console.log(`Events (30d):  ${health.events30d}`);
  console.log(
    `Last event:    ${
      health.lastSuccessIso ? humanRelative(new Date(health.lastSuccessIso)) : chalk.gray("—")
    }`,
  );
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

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  SpendEventsApiService,
  type SpendGroupBy,
  type SpendSummaryRow,
} from "@/client-sdk/services/spend-events/spend-events-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { parseInstantOrNull } from "../../utils/instant";

const parseInstant = (value: string, flag: string): number => {
  const parsed = parseInstantOrNull(value);
  if (parsed === null) {
    console.error(chalk.red(`Invalid ${flag} value: ${value}`));
    process.exit(1);
  }
  return parsed;
};

const parsePositiveInt = (value: string, flag: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(chalk.red(`Invalid ${flag} value: ${value}`));
    process.exit(1);
  }
  return parsed;
};

const GROUP_BY_VALUES: readonly SpendGroupBy[] = [
  "virtual_key",
  "end_user",
  "project",
  "model",
  "provider",
  "principal",
  "request_type",
];

/** What a row of each grouping is, for the one-line count after the walk. */
const GROUP_LABELS: Record<string, string> = {
  virtual_key: "keys",
  end_user: "end users",
  project: "projects",
  model: "models",
  provider: "providers",
  principal: "people",
  request_type: "request types",
};

/**
 * `--metadata tier=gold`, repeated. Equals rather than a colon, because the
 * value may itself contain a colon and a shell user expects `key=value`.
 */
function parseMetadataFlags(
  pairs: string[] | undefined,
): Record<string, string[]> | undefined {
  if (pairs === undefined || pairs.length === 0) return undefined;
  const parsed: Record<string, string[]> = {};
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      console.error(
        chalk.red(`Invalid --metadata value: ${pair} (expected key=value)`),
      );
      process.exit(1);
    }
    const key = pair.slice(0, separator);
    (parsed[key] ??= []).push(pair.slice(separator + 1));
  }
  return parsed;
}

export const spendSummaryCommand = async (options: {
  groupBy?: string;
  bucket?: string;
  timezone?: string;
  allowUnstable?: boolean;
  from?: string;
  to?: string;
  project?: string;
  team?: string;
  model?: string[];
  provider?: string[];
  endUser?: string[];
  metadata?: string[];
  limit?: string;
}): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  // A typo must not silently become a virtual-key report on a billing
  // reconciliation surface.
  const groupBy = (options.groupBy ?? "virtual_key")
    .split(",")
    .map((part) => part.trim());
  const unknown = groupBy.filter(
    (key) => !GROUP_BY_VALUES.includes(key as SpendGroupBy),
  );
  if (unknown.length > 0 || groupBy.length > 2) {
    console.error(
      chalk.red(
        `Invalid --group-by value: ${options.groupBy} (expected one or two of ${GROUP_BY_VALUES.join(", ")})`,
      ),
    );
    process.exit(1);
  }
  const now = Date.now();
  const fromMs =
    options.from !== undefined
      ? parseInstant(options.from, "--from")
      : now - 24 * 60 * 60 * 1000;
  const toMs =
    options.to !== undefined ? parseInstant(options.to, "--to") : now;
  const service = new SpendEventsApiService({ apiKey });
  const spinner = createSpinner("Reading spend summaries...").start();
  try {
    // Walk every page. Reading only the first one reported "50 keys" for a
    // window holding thousands, and a reconciliation checksum that silently
    // covers part of the window is worse than no checksum at all. `--limit`
    // is the page size; the walk is always the whole window.
    const data: SpendSummaryRow[] = [];
    for await (const row of service.iterSummaries({
      groupBy: groupBy as SpendGroupBy[],
      bucket: options.bucket as "none" | "hour" | "day" | undefined,
      timezone: options.timezone,
      allowUnstable: options.allowUnstable,
      from: fromMs,
      to: toMs,
      projectId: options.project,
      teamId: options.team,
      model: options.model,
      providerKey: options.provider,
      endUserId: options.endUser,
      metadata: parseMetadataFlags(options.metadata),
      limit:
        options.limit !== undefined
          ? parsePositiveInt(options.limit, "--limit")
          : undefined,
    })) {
      data.push(row);
    }
    const settled = data.reduce((sum, row) => sum + row.settled_count, 0);
    spinner.succeed(
      `${data.length} ${GROUP_LABELS[groupBy[0] ?? "virtual_key"] ?? "groups"}${settled > 0 ? chalk.yellow(`, ${settled} settled request${settled !== 1 ? "s" : ""} unpriced`) : ""}`,
    );
    return {
      data,
      table: () => {
        console.log();
        for (const row of data) {
          const settledNote =
            row.settled_count > 0
              ? chalk.yellow(` (+${row.settled_count} settled, unpriced)`)
              : "";
          console.log(
            `${chalk.cyan(row.key || "(unattributed)")}  $${Number(row.cost.total_usd).toFixed(6)}  ${row.event_count} events${settledNote}  in ${row.usage.input_tokens} / out ${row.usage.output_tokens}`,
          );
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "read spend summaries" });
    process.exit(1);
  }
};

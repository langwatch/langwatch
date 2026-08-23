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
import { parseKeyValueFlags } from "../../utils/keyValueFlags";

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

const BUCKET_VALUES = ["none", "hour", "day"] as const;

/**
 * Everything that tells one row from another. A rollup can be grouped two
 * ways and bucketed by time, so `key` alone is now ambiguous: two rows sharing
 * a model but not an end user, or a day, would print under the same label and
 * read as duplicates of each other.
 */
function rowLabel(row: SpendSummaryRow): string {
  const dimensions = Object.values(row.group)
    .map((value) => value || "(unattributed)")
    .join(" / ");
  const label = dimensions || row.key || "(unattributed)";
  return row.bucket_start === null ? label : `${row.bucket_start}  ${label}`;
}

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
 * What the row count after the walk is a count OF.
 *
 * A dimension's own noun is only true when the walk has one dimension and no
 * time bucket. Add a second dimension or an hour column and each row is a
 * combination, so calling twelve model-by-hour rows "12 models" states
 * something the data does not say, on a surface whose whole job is being
 * exactly right about counts.
 */
export function summaryCountNoun({
  groupBy,
  bucket,
}: {
  groupBy: string[];
  bucket?: string;
}): string {
  const countsOneDimension =
    groupBy.length === 1 && (bucket === undefined || bucket === "none");
  if (!countsOneDimension) return "rows";
  return GROUP_LABELS[groupBy[0] ?? "virtual_key"] ?? "groups";
}

/**
 * Refuse a value the API does not accept, naming what it does. A typo must
 * not silently become a different report on a billing reconciliation surface,
 * and finding that out from a server 400 is finding it out too late.
 */
function oneOf<T extends string>({
  value,
  allowed,
  flag,
}: {
  value: string;
  allowed: readonly T[];
  flag: string;
}): T {
  if (!allowed.includes(value as T)) {
    console.error(
      chalk.red(
        `Invalid ${flag} value: ${value} (expected one of ${allowed.join(", ")})`,
      ),
    );
    process.exit(1);
  }
  return value as T;
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
  const groupBy = (options.groupBy ?? "virtual_key")
    .split(",")
    .map((part) => oneOf({ value: part.trim(), allowed: GROUP_BY_VALUES, flag: "--group-by" }));
  if (groupBy.length > 2) {
    console.error(chalk.red("--group-by takes at most two dimensions"));
    process.exit(1);
  }
  const bucket =
    options.bucket === undefined
      ? undefined
      : oneOf({
          value: options.bucket,
          allowed: BUCKET_VALUES,
          flag: "--bucket",
        });
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
      groupBy,
      bucket,
      timezone: options.timezone,
      allowUnstable: options.allowUnstable,
      from: fromMs,
      to: toMs,
      projectId: options.project,
      teamId: options.team,
      model: options.model,
      providerKey: options.provider,
      endUserId: options.endUser,
      metadata: parseKeyValueFlags({
        pairs: options.metadata,
        flag: "--metadata",
      }),
      limit:
        options.limit !== undefined
          ? parsePositiveInt(options.limit, "--limit")
          : undefined,
    })) {
      data.push(row);
    }
    const settled = data.reduce((sum, row) => sum + row.settled_count, 0);
    const noun = summaryCountNoun({ groupBy, bucket });
    spinner.succeed(
      `${data.length} ${noun}${settled > 0 ? chalk.yellow(`, ${settled} settled request${settled !== 1 ? "s" : ""} unpriced`) : ""}`,
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
            `${chalk.cyan(rowLabel(row))}  $${Number(row.cost.total_usd).toFixed(6)}  ${row.event_count} events${settledNote}  in ${row.usage.input_tokens} / out ${row.usage.output_tokens}`,
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

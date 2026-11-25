/**
 * `langwatch trace facets [field]`: what the filter fields hold in this project now; with `trace
 * fields`, it turns a guessed value into a working filter without a failed search.
 * @see specs/traces/trace-filter-api.feature
 */

import chalk from "chalk";

import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { searchedProjectSlug } from "../../utils/searchedProject";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import {
  DEFAULT_LOOKBACK,
  resolveTimeWindowOrExit,
  shellQuote,
  type TimeWindow,
  type WindowDocument,
  windowDocument,
} from "../../utils/timeWindow";
import { type SearchedDocument, searchedDocument, searchedLines, widenCommand } from "./searched";

export interface TraceFacetsOptions {
  prefix?: string;
  limit?: string;
  startDate?: string;
  endDate?: string;
  since?: string;
  project?: string;
}

/** Shapes the endpoint answers with, told apart by what is on the payload. */
interface FacetValuesPayload {
  values: { value: string; label?: string; count: number }[];
  total: number;
  hasMore: boolean;
}

interface DiscoverPayload {
  facets: {
    key: string;
    kind: string;
    label: string;
    group: string;
    topValues?: { value: string; count: number }[];
    totalDistinct?: number;
    min?: number;
    max?: number;
    topKeys?: { value: string; count: number }[];
  }[];
  pending: boolean;
}

function isValues(payload: unknown): payload is FacetValuesPayload {
  return typeof payload === "object" && payload !== null && "values" in payload;
}

/** One line per facet: what it is, and a taste of what is in it. */
function summarise(facet: DiscoverPayload["facets"][number]): string {
  if (facet.kind === "range") {
    return `${facet.min ?? ""} to ${facet.max ?? ""}`;
  }
  const entries = facet.topValues ?? facet.topKeys ?? [];
  return entries
    .slice(0, 5)
    .map((entry) => `${entry.value} (${entry.count})`)
    .join(", ");
}

/** The values answer: one field, its values, and whether more remain. */
function valuesResult({
  payload,
  field,
  read,
}: {
  payload: FacetValuesPayload;
  field: string | undefined;
  read: FacetsRead;
}): CommandResult {
  const empty = payload.values.length === 0 ? read.empty : undefined;
  return {
    data: {
      ...payload,
      window: read.window,
      ...(empty ? { searched: empty.searched, widen: empty.widen } : {}),
    },
    table: () => {
      console.log();
      formatTable({
        data: payload.values.map((entry) => ({
          Value: entry.label ?? entry.value,
          Traces: String(entry.count),
        })),
        headers: ["Value", "Traces"],
        emptyMessage: `Nothing recorded for ${field ?? "that field"} between ${read.window.from} and ${read.window.to}.`,
      });
      if (empty) printEmptyFacets(empty);
      if (payload.hasMore) {
        console.log();
        console.log(
          chalk.gray(
            `More values remain. Narrow with ${chalk.cyan("--prefix")} or raise ${chalk.cyan("--limit")}.`,
          ),
        );
      }
      console.log();
    },
  };
}

/** The discovery answer: every facet this project has, with a taste of each. */
function discoverResult({
  discover,
  read,
}: {
  discover: DiscoverPayload;
  read: FacetsRead;
}): CommandResult {
  const empty = discover.facets.length === 0 ? read.empty : undefined;
  return {
    data: {
      ...discover,
      window: read.window,
      ...(empty ? { searched: empty.searched, widen: empty.widen } : {}),
    },
    table: () => {
      console.log();
      formatTable({
        data: discover.facets.map((facet) => ({
          Field: facet.key,
          Kind: facet.kind,
          "Top values": summarise(facet),
        })),
        headers: ["Field", "Kind", "Top values"],
        emptyMessage: `No facets: this project has no traces between ${read.window.from} and ${read.window.to}.`,
      });
      if (empty) printEmptyFacets(empty);
      if (discover.pending) {
        console.log();
        console.log(
          chalk.yellow(
            "These values are still being computed. Run the command again shortly for the finished set.",
          ),
        );
      }
      console.log();
      console.log(
        chalk.gray(
          `One field in full: ${chalk.cyan("langwatch trace facets <field>")}. Every field the language knows: ${chalk.cyan("langwatch trace fields")}.`,
        ),
      );
      console.log();
    },
  };
}

/** The window a facets read covered, and what to say if it came back empty. */
interface FacetsRead {
  window: WindowDocument;
  empty: { searched: SearchedDocument; widen: string | null };
}

const printEmptyFacets = (empty: FacetsRead["empty"]): void => {
  console.log();
  for (const line of searchedLines(empty.searched)) console.log(chalk.gray(`  ${line}`));
  if (empty.widen) console.log(chalk.gray(`Read further back: ${chalk.cyan(empty.widen)}`));
};

/** The read's window, plus the empty-answer description, looked up only when it is needed. */
const describeRead = async ({
  field,
  options,
  window,
  isEmpty,
}: {
  field: string | undefined;
  options: TraceFacetsOptions;
  window: TimeWindow;
  isEmpty: boolean;
}): Promise<FacetsRead> => {
  const searched = {
    project: isEmpty ? await searchedProjectSlug({ project: options.project }) : null,
    window,
  };
  const base =
    field === undefined ? "langwatch trace facets" : `langwatch trace facets ${shellQuote(field)}`;
  return {
    window: windowDocument({ window, lookback: DEFAULT_LOOKBACK }),
    empty: {
      searched: searchedDocument(searched),
      widen: widenCommand({ base, searched, project: options.project }) ?? null,
    },
  };
};

/** `--limit` as a number, or a refusal. */
function resolveLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) {
    console.error(chalk.red("Error: --limit must be a whole number of at least 1"));
    process.exit(1);
  }
  return limit;
}

export const traceFacetsCommand = async (
  field: string | undefined,
  options: TraceFacetsOptions = {},
): Promise<CommandResult | void> => {
  // The flag is checked before the credential: a bad --limit is the caller's to
  // fix whether or not a key is configured, and reading the credential first
  // answers a question they did not ask.
  const limit = resolveLimit(options.limit);
  const window = resolveTimeWindowOrExit({
    startDate: options.startDate,
    endDate: options.endDate,
    since: options.since,
    now: Date.now(),
  });

  await resolveCredentials({ project: options.project });
  const service = new TracesApiService();
  const spinner = createSpinner(
    field === undefined ? "Reading the project's facets..." : `Reading the values of ${field}...`,
  ).start();

  try {
    const payload = await service.facets({
      ...(field === undefined ? {} : { field }),
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
      ...(limit === undefined ? {} : { limit }),
      // Sent as epoch ms: the CLI owns the default window and the relative forms.
      startDate: String(window.from),
      endDate: String(window.to),
    });

    if (isValues(payload)) {
      spinner.succeed(
        `${payload.values.length} of ${payload.total} value${payload.total !== 1 ? "s" : ""}${payload.hasMore ? ", more remain" : ""}`,
      );
      const read = await describeRead({
        field,
        options,
        window,
        isEmpty: payload.values.length === 0,
      });
      return valuesResult({ payload, field, read });
    }

    const discover = payload as unknown as DiscoverPayload;
    spinner.succeed(
      `${discover.facets.length} facet${discover.facets.length !== 1 ? "s" : ""}${discover.pending ? ", still being computed" : ""}`,
    );
    const read = await describeRead({
      field,
      options,
      window,
      isEmpty: discover.facets.length === 0,
    });
    return discoverResult({ discover, read });
  } catch (error) {
    failSpinner({ spinner, error, action: "read trace facets" });
    process.exit(1);
  }
};

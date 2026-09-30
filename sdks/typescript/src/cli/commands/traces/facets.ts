/**
 * `langwatch trace facets [field]` — what the filter fields actually hold.
 *
 * The other half of `langwatch trace fields`. That one says a field exists;
 * this says what is in it, in this project, right now. The pair is what turns
 * "I think the origin is called `app`" into `origin:application` without a
 * round trip through a failed search.
 *
 * @see specs/traces/trace-filter-api.feature
 */

import chalk from "chalk";

import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

export interface TraceFacetsOptions {
  prefix?: string;
  limit?: string;
  startDate?: string;
  endDate?: string;
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
}: {
  payload: FacetValuesPayload;
  field: string | undefined;
}): CommandResult {
  return {
    data: payload,
    table: () => {
      console.log();
      formatTable({
        data: payload.values.map((entry) => ({
          Value: entry.label ?? entry.value,
          Traces: String(entry.count),
        })),
        headers: ["Value", "Traces"],
        emptyMessage: `Nothing recorded for ${field ?? "that field"} in this window.`,
      });
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
function discoverResult(discover: DiscoverPayload): CommandResult {
  return {
    data: discover,
    table: () => {
      console.log();
      formatTable({
        data: discover.facets.map((facet) => ({
          Field: facet.key,
          Kind: facet.kind,
          "Top values": summarise(facet),
        })),
        headers: ["Field", "Kind", "Top values"],
        emptyMessage:
          "No facets yet: this project has no traces in the window.",
      });
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

/** `--limit` as a number, or a refusal. */
function resolveLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) {
    console.error(
      chalk.red("Error: --limit must be a whole number of at least 1"),
    );
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

  await resolveCredentials({ project: options.project });
  const service = new TracesApiService();
  const spinner = createSpinner(
    field === undefined
      ? "Reading the project's facets..."
      : `Reading the values of ${field}...`,
  ).start();

  try {
    const payload = await service.facets({
      ...(field === undefined ? {} : { field }),
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
      ...(limit === undefined ? {} : { limit }),
      ...(options.startDate === undefined
        ? {}
        : { startDate: options.startDate }),
      ...(options.endDate === undefined ? {} : { endDate: options.endDate }),
    });

    if (isValues(payload)) {
      spinner.succeed(
        `${payload.values.length} of ${payload.total} value${payload.total !== 1 ? "s" : ""}${payload.hasMore ? ", more remain" : ""}`,
      );
      return valuesResult({ payload, field });
    }

    const discover = payload as unknown as DiscoverPayload;
    spinner.succeed(
      `${discover.facets.length} facet${discover.facets.length !== 1 ? "s" : ""}${discover.pending ? ", still being computed" : ""}`,
    );
    return discoverResult(discover);
  } catch (error) {
    failSpinner({ spinner, error, action: "read trace facets" });
    process.exit(1);
  }
};

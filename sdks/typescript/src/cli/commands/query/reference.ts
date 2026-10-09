/**
 * `langwatch query reference` — both query languages, in one read.
 *
 * The first command an agent should run before it filters or aggregates
 * anything: it says which language answers which kind of question, lists every
 * field and column, and carries worked examples the platform validates before
 * publishing them. Each one also says whether THIS key can run it.
 *
 * `--section` exists because the whole document is large and an agent usually
 * knows which half it needs. The default is still the whole thing, so a caller
 * that does not know cannot get half an answer by accident.
 *
 * @see specs/analytics/query-reference.feature
 */

import chalk from "chalk";

import {
  type QueryReferenceResult,
  QueryApiService,
} from "@/client-sdk/services/query/query-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { runnableLabel } from "./requirements";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/** The slices a caller can ask for by name. */
export const QUERY_REFERENCE_SECTIONS = [
  "lwql",
  "trace-filter",
  "examples",
  "decisions",
] as const;

type QueryReferenceSection = (typeof QUERY_REFERENCE_SECTIONS)[number];

export interface QueryReferenceOptions {
  section?: string;
  project?: string;
}

function resolveSection(section?: string): QueryReferenceSection | undefined {
  if (section === undefined) return undefined;
  if (!(QUERY_REFERENCE_SECTIONS as readonly string[]).includes(section)) {
    console.error(
      chalk.red(
        `Error: --section must be one of ${QUERY_REFERENCE_SECTIONS.join(", ")}`,
      ),
    );
    process.exit(1);
  }
  return section as QueryReferenceSection;
}

/** The slice of the document a `--section` names, for the machine formats. */
function projectSection({
  reference,
  section,
}: {
  reference: QueryReferenceResult;
  section?: QueryReferenceSection;
}): unknown {
  if (section === undefined) return reference;
  if (section === "lwql") return reference.lwql;
  if (section === "trace-filter") return reference.traceFilter;
  if (section === "examples") return reference.examples;
  return reference.decisionTable;
}

function printDecisions(reference: QueryReferenceResult): void {
  console.log();
  console.log(chalk.bold("Which language answers which question"));
  for (const row of reference.decisionTable) {
    console.log();
    console.log(`  ${chalk.cyan(row.when)}`);
    console.log(`    ${chalk.bold("use")}  ${row.use}`);
    console.log(`    ${chalk.gray("why")}  ${chalk.gray(row.why)}`);
  }
}

function printLwql(reference: QueryReferenceResult): void {
  console.log();
  console.log(
    `${chalk.bold("LangWatchQL")} ${chalk.gray(
      reference.lwql.enabled
        ? `— SQL over ${reference.lwql.schema.database}`
        : "— not enabled for this project",
    )}`,
  );
  formatTable({
    data: reference.lwql.schema.views.map((view) => ({
      View: view.name,
      "Time column": view.timeColumn,
      Columns: String(view.columns.length),
      Grain: view.grain,
    })),
    headers: ["View", "Time column", "Columns", "Grain"],
  });
  console.log();
  console.log(
    chalk.gray(
      `Ceilings: ${reference.lwql.limits.maxRowsReturned} rows, ${reference.lwql.limits.maxExecutionTimeSeconds}s. ${reference.lwql.limits.pagination}`,
    ),
  );
  console.log(
    chalk.gray(
      `Columns and types: ${chalk.cyan("langwatch query schema")}`,
    ),
  );
}

function printTraceFilter(reference: QueryReferenceResult): void {
  console.log();
  console.log(
    `${chalk.bold("Trace filter")} ${chalk.gray(`— ${reference.traceFilter.fields.length} fields`)}`,
  );
  formatTable({
    data: reference.traceFilter.dynamicPrefixes.map((prefix) => ({
      Prefix: prefix.prefix,
      Matches: prefix.label,
      "Older spellings": prefix.aliases.join(", "),
    })),
    headers: ["Prefix", "Matches", "Older spellings"],
  });
  console.log();
  console.log(
    chalk.gray(
      `Every field: ${chalk.cyan("langwatch trace fields")}. Syntax: ${chalk.cyan("langwatch trace fields --syntax")}. Real values: ${chalk.cyan("langwatch trace facets <field>")}.`,
    ),
  );
}

function printExamples(reference: QueryReferenceResult): void {
  console.log();
  console.log(chalk.bold("Examples"));
  formatTable({
    data: reference.examples.map((example) => ({
      Id: example.id,
      Language: example.language,
      Intent: example.intent,
      Title: example.title,
      Runnable: runnableLabel(example),
    })),
    headers: ["Id", "Language", "Intent", "Title", "Runnable"],
  });
  console.log();
  console.log(
    chalk.gray(
      `Full text: ${chalk.cyan("langwatch query examples")} (add ${chalk.cyan("--tag")} or ${chalk.cyan("--language")} to narrow).`,
    ),
  );
}

export const queryReferenceCommand = async (
  options: QueryReferenceOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options.project });

  const section = resolveSection(options.section);
  const service = new QueryApiService();
  const spinner = createSpinner("Reading the query reference...").start();

  try {
    const reference = await service.reference();

    spinner.succeed(
      `Query reference v${reference.version}: ${reference.lwql.schema.views.length} views, ${reference.traceFilter.fields.length} filter fields, ${reference.examples.length} examples`,
    );

    return {
      data: projectSection({ reference, section }),
      table: () => {
        if (section === undefined || section === "decisions") {
          printDecisions(reference);
        }
        if (section === undefined || section === "lwql") printLwql(reference);
        if (section === undefined || section === "trace-filter") {
          printTraceFilter(reference);
        }
        if (section === undefined || section === "examples") {
          printExamples(reference);
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "read the query reference" });
    process.exit(1);
  }
};

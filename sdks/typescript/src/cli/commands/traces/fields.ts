/**
 * `langwatch trace fields` — what a trace filter can name.
 *
 * Reads the query reference, so the list is the platform's own rather than a
 * copy of it: the field registry lives in the app, and a second list in the CLI
 * would be a second thing to keep in step. That is the exact drift that left
 * the MCP server naming fields the product had renamed.
 *
 * `--syntax` prints the language's own document and `--examples` the filter
 * examples, because both come down the same call and a caller learning the
 * language wants them next to the field list, not from three commands.
 *
 * @see specs/traces/trace-filter-api.feature
 */

import chalk from "chalk";

import {
  type QueryReferenceResult,
  QueryApiService,
} from "@/client-sdk/services/query/query-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { runnableLabel } from "../query/requirements";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

export interface TraceFieldsOptions {
  syntax?: boolean;
  examples?: boolean;
  project?: string;
}

/** Values shown inline before the rest are left to the facets command. */
const KNOWN_VALUES_SHOWN = 6;

function printFields(reference: QueryReferenceResult): void {
  console.log();
  formatTable({
    data: reference.traceFilter.fields.map((field) => ({
      Field: field.name,
      Type: field.valueType,
      Group: field.group ?? "",
      Values:
        field.knownValues.length > 0
          ? field.knownValues.slice(0, KNOWN_VALUES_SHOWN).join(", ")
          : field.facetable
            ? chalk.gray("ask facets")
            : "",
    })),
    headers: ["Field", "Type", "Group", "Values"],
  });
  console.log();
  formatTable({
    data: reference.traceFilter.dynamicPrefixes.map((prefix) => ({
      Prefix: `${prefix.prefix}<key>`,
      Matches: prefix.label,
      "Older spellings": prefix.aliases.join(", "),
    })),
    headers: ["Prefix", "Matches", "Older spellings"],
  });
}

function printExamples(reference: QueryReferenceResult): void {
  const examples = reference.examples.filter(
    (example) => example.language === "trace-filter",
  );
  console.log();
  for (const example of examples) {
    console.log(`  ${chalk.cyan(example.text)}`);
    console.log(`    ${chalk.gray(example.title)}`);
    if (!example.available) {
      console.log(`    ${chalk.yellow(runnableLabel(example))}`);
    }
    if (example.notes) console.log(`    ${chalk.gray(example.notes)}`);
    console.log();
  }
}

export const traceFieldsCommand = async (
  options: TraceFieldsOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options.project });

  const service = new QueryApiService();
  const spinner = createSpinner("Reading the trace filter fields...").start();

  try {
    const reference = await service.reference();
    const { traceFilter } = reference;

    spinner.succeed(
      `${traceFilter.fields.length} field${traceFilter.fields.length !== 1 ? "s" : ""} and ${traceFilter.dynamicPrefixes.length} attribute namespaces`,
    );

    const data = options.syntax
      ? { syntax: traceFilter.syntax }
      : options.examples
        ? {
            examples: reference.examples.filter(
              (example) => example.language === "trace-filter",
            ),
          }
        : {
            fields: traceFilter.fields,
            dynamicPrefixes: traceFilter.dynamicPrefixes,
          };

    return {
      data,
      table: () => {
        if (options.syntax) {
          console.log();
          console.log(traceFilter.syntax);
          return;
        }
        if (options.examples) {
          printExamples(reference);
          return;
        }
        printFields(reference);
        console.log();
        console.log(
          chalk.gray(
            `Syntax: ${chalk.cyan("langwatch trace fields --syntax")}. Worked filters: ${chalk.cyan("langwatch trace fields --examples")}. Real values: ${chalk.cyan("langwatch trace facets <field>")}.`,
          ),
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "read the trace filter fields" });
    process.exit(1);
  }
};

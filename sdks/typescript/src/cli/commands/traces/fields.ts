/**
 * `langwatch trace fields`: what a trace filter can name, read from the platform's query reference
 * rather than a CLI copy that drifts. `--syntax` and `--examples` come down the same call.
 * @see specs/traces/trace-filter-api.feature
 */

import chalk from "chalk";

import {
  type QueryReferenceResult,
  QueryApiService,
} from "@/client-sdk/services/query/query-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { runnableLabel } from "../query/requirements";

export interface TraceFieldsOptions {
  syntax?: boolean;
  examples?: boolean;
  project?: string;
}

/** Values shown inline before the rest are left to the facets command. */
const KNOWN_VALUES_SHOWN = 6;

function knownValuesCell(field: QueryReferenceResult["traceFilter"]["fields"][number]): string {
  if (field.knownValues.length > 0) {
    return field.knownValues.slice(0, KNOWN_VALUES_SHOWN).join(", ");
  }
  return field.facetable ? chalk.gray("ask facets") : "";
}

function commandData(reference: QueryReferenceResult, options: TraceFieldsOptions) {
  const { traceFilter } = reference;
  if (options.syntax) return { syntax: traceFilter.syntax };
  if (options.examples) {
    return {
      examples: reference.examples.filter((example) => example.language === "trace-filter"),
    };
  }
  return {
    fields: traceFilter.fields,
    dynamicPrefixes: traceFilter.dynamicPrefixes,
  };
}

function printFields(reference: QueryReferenceResult): void {
  console.log();
  formatTable({
    data: reference.traceFilter.fields.map((field) => ({
      Field: field.name,
      Type: field.valueType,
      Group: field.group ?? "",
      Values: knownValuesCell(field),
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
  const examples = reference.examples.filter((example) => example.language === "trace-filter");
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

    const data = commandData(reference, options);

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

/**
 * `langwatch query examples` — the worked queries, in full.
 *
 * Split from `query reference` because the two answer different questions. The
 * reference is "what can I query"; this is "show me one I can copy". Printing
 * every statement inside the reference would bury the field list under a page
 * of SQL, and a caller after one example would read the whole document to find
 * it.
 *
 * @see specs/analytics/lwql-cli-query.feature
 */

import chalk from "chalk";

import {
  type QueryReferenceResult,
  QueryApiService,
} from "@/client-sdk/services/query/query-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { runnableLabel } from "./requirements";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/** The two languages an example can be written in. */
export const QUERY_EXAMPLE_LANGUAGES = ["lwql", "trace-filter"] as const;

export interface QueryExamplesOptions {
  tag?: string;
  language?: string;
  project?: string;
}

type Example = QueryReferenceResult["examples"][number];

function resolveLanguage(language?: string): string | undefined {
  if (language === undefined) return undefined;
  if (!(QUERY_EXAMPLE_LANGUAGES as readonly string[]).includes(language)) {
    console.error(
      chalk.red(
        `Error: --language must be one of ${QUERY_EXAMPLE_LANGUAGES.join(", ")}`,
      ),
    );
    process.exit(1);
  }
  return language;
}

/**
 * Matches on tag OR intent.
 *
 * An intent is the one tag every example is guaranteed to carry, so a caller
 * that asks for `--tag cost` and means "the cost questions" gets them rather
 * than an empty list and no hint why.
 */
function matches({
  example,
  tag,
  language,
}: {
  example: Example;
  tag?: string;
  language?: string;
}): boolean {
  if (language !== undefined && example.language !== language) return false;
  if (tag === undefined) return true;
  const wanted = tag.toLowerCase();
  return (
    example.intent.toLowerCase() === wanted ||
    example.tags.some((candidate) => candidate.toLowerCase() === wanted)
  );
}

function printExample(example: Example): void {
  console.log();
  console.log(
    `${chalk.cyan.bold(example.id)} ${chalk.gray(`— ${example.title}`)}`,
  );
  console.log(
    chalk.gray(
      `  ${example.language} · ${example.intent} · ${example.tags.join(", ")}${
        example.available ? "" : ` · ${runnableLabel(example)}`
      }`,
    ),
  );
  console.log();
  for (const line of example.text.split("\n")) {
    console.log(`    ${line}`);
  }
  if (example.parameters.length > 0) {
    console.log();
    for (const parameter of example.parameters) {
      console.log(
        chalk.gray(
          `    {${parameter.name}:${parameter.type}}  ${parameter.description}`,
        ),
      );
    }
  }
  if (example.notes) {
    console.log();
    console.log(chalk.gray(`    ${example.notes}`));
  }
}

export const queryExamplesCommand = async (
  options: QueryExamplesOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options.project });

  const language = resolveLanguage(options.language);
  const service = new QueryApiService();
  const spinner = createSpinner("Reading the example library...").start();

  try {
    const reference = await service.reference();
    const examples = reference.examples.filter((example) =>
      matches({ example, tag: options.tag, language }),
    );

    spinner.succeed(
      `${examples.length} example${examples.length !== 1 ? "s" : ""}`,
    );

    return {
      data: { examples },
      table: () => {
        if (examples.length === 0) {
          console.log();
          console.log(
            chalk.gray(
              `No example carries that tag. Tags in use: ${[
                ...new Set(reference.examples.flatMap((one) => one.tags)),
              ]
                .sort()
                .join(", ")}`,
            ),
          );
          console.log();
          return;
        }
        for (const example of examples) printExample(example);
        console.log();
        console.log(
          chalk.gray(
            `Run one: ${chalk.cyan('langwatch query "<statement>"')} or ${chalk.cyan('langwatch trace search --filter "<filter>"')}.`,
          ),
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "read the example library" });
    process.exit(1);
  }
};

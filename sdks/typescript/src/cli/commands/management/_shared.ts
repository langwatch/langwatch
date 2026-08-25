/**
 * The one shape every management command has.
 *
 * Nine families, forty-odd verbs, and each of them does exactly the same four
 * things: resolve credentials, spin while one API call runs, hand the FULL
 * response to the output port as `data`, and fail through `failSpinner` so the
 * error renders in whatever format the caller asked for. Written out per file
 * that is forty copies of the same block, and forty chances for one of them to
 * quietly return a projection of the response instead of the response.
 *
 * `runManagement` is that block, once. A command file is then what it should
 * be: the request it makes and the table it draws.
 */
import chalk from "chalk";
import { resolveCredentials } from "../../utils/apiKey";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import { ManagementFlagError } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

export interface RunManagementParams<T> {
  /** Short description of what is being done, e.g. `list custom roles`. */
  action: string;
  /** The spinner's running text, e.g. `Fetching custom roles...`. */
  pending: string;
  /** The one API call. Its resolved value is the command's machine output. */
  run: () => Promise<T>;
  /** The spinner's success line. */
  succeed: (result: T) => string;
  /** The human rendering, invoked only when the resolved format is `table`. */
  table: (result: T) => void;
  /**
   * Whether this command needs an organization API key resolved from the
   * usual places. The instance-provisioning family authenticates against the
   * instance instead, so it opts out.
   */
  requiresCredentials?: boolean;
}

/**
 * Run one management API call and return it as a `CommandResult`.
 *
 * `data` is the response verbatim, never a projection, so `-o json` gives a
 * scripted caller exactly what the API said, which is the whole point of the
 * machine format.
 */
export const runManagement = async <T>({
  action,
  pending,
  run,
  succeed,
  table,
  requiresCredentials = true,
}: RunManagementParams<T>): Promise<CommandResult | void> => {
  if (requiresCredentials) await resolveCredentials();

  const spinner = createSpinner(pending).start();

  try {
    const result = await run();
    spinner.succeed(succeed(result));
    return { data: result, table: () => table(result) };
  } catch (error) {
    failSpinner({ spinner, error, action });
    process.exit(1);
  }
};

/**
 * Run a flag parser, reporting a malformed value as a validation error before
 * any request is made. A bad `--binding` is the caller's typo, not a refusal
 * the platform should have to spell out.
 */
export const withParsedFlags = <T>(parse: () => T): T => {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ManagementFlagError) {
      reportCommandError({ error: commandValidationError(error.message) });
      process.exit(1);
    }
    throw error;
  }
};

/** Shared so every single-resource read across the families prints one shape. */
export const printFacts = (facts: Array<[string, string]>): void => {
  const width = Math.max(...facts.map(([label]) => label.length));
  console.log();
  for (const [label, value] of facts) {
    console.log(`  ${chalk.gray(`${label}:`.padEnd(width + 1))} ${value}`);
  }
  console.log();
};

/** Shared so an empty listing always offers the command that fills it. */
export const printEmpty = ({ what, hint }: { what: string; hint?: string }): void => {
  console.log();
  console.log(chalk.gray(`No ${what} found.`));
  if (hint) console.log(chalk.cyan(`  ${hint}`));
  console.log();
};

/** Shared so every spinner success line pluralises its noun the same way. */
export const counted = ({
  count,
  singular,
  plural,
}: {
  count: number;
  singular: string;
  plural: string;
}): string => `${count} ${count === 1 ? singular : plural}`;

/** `—` for a value the platform has not set, so a table never shows "null". */
export const orDash = (value: string | null | undefined): string =>
  value === null || value === undefined || value === "" ? chalk.gray("—") : value;

/** A date the way every other CLI table renders one. */
export const asDate = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleDateString() : chalk.gray("never");

import chalk from "chalk";
import type {
  TestSuite,
  TestSuitesApiService,
} from "@/client-sdk/services/test-suites";
import { createCliTestSuitesService } from "./cli-test-suites-service";

/**
 * A test suite reference that names nothing, or more than one thing.
 *
 * Both readings are refusals the caller can fix from the message alone, so
 * they carry the offered ids rather than a generic failure.
 */
export class SuiteReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuiteReferenceError";
  }
}

/**
 * Finds the test suite a reference names.
 *
 * An id is tried first, then an exact name, then a name compared without case.
 * A name two suites share is refused with both ids, because picking one for
 * the caller would file the case somewhere they did not ask for.
 *
 * @see specs/features/test-suite-cli.feature
 * @see specs/features/scenario-cli.feature
 */
export async function resolveSuiteReference({
  reference,
  service,
}: {
  reference: string;
  service?: TestSuitesApiService;
}): Promise<TestSuite> {
  const suitesService = service ?? createCliTestSuitesService();
  const suites = await suitesService.list();

  const byId = suites.find((suite) => suite.id === reference);
  if (byId) return byId;

  const wanted = reference.trim();
  const exact = suites.filter((suite) => suite.name === wanted);
  const matches =
    exact.length > 0
      ? exact
      : suites.filter(
          (suite) => suite.name.toLowerCase() === wanted.toLowerCase(),
        );

  if (matches.length === 1) return matches[0]!;

  if (matches.length > 1) {
    throw new SuiteReferenceError(
      `More than one test suite is named "${reference}". Name it by ID instead: ${matches
        .map((suite) => suite.id)
        .join(", ")}`,
    );
  }

  throw new SuiteReferenceError(
    `Test suite "${reference}" not found. List the test suites with: langwatch test-suite list`,
  );
}

/**
 * Turns a reference into an id, ending the command when the name matches
 * nothing or more than one suite. Kept here rather than in a command module so
 * every command that takes a suite reference refuses it the same way.
 */
export async function resolveSuiteId({
  reference,
  service,
}: {
  reference: string;
  service?: TestSuitesApiService;
}): Promise<string> {
  try {
    const suite = await resolveSuiteReference({ reference, service });
    return suite.id;
  } catch (error) {
    if (error instanceof SuiteReferenceError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  }
}

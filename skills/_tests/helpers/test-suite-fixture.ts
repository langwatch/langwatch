import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const cliDistPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../sdks/typescript/dist/cli/index.js",
);

/** The fields of `langwatch test-suite get --format json` the tests read. */
export interface TestSuiteRow {
  id: string;
  name: string;
  scenarioCount: number;
}

function runTestSuiteCommand({
  workingDirectory,
  args,
}: {
  workingDirectory: string;
  args: string[];
}): unknown {
  const stdout = execFileSync("node", [cliDistPath, "test-suite", ...args, "--format", "json"], {
    cwd: workingDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(stdout);
}

/**
 * Seeds a test suite the way a user would, from `workingDirectory`, whose .env
 * carries the project key.
 */
export function createTestSuite({
  workingDirectory,
  name,
}: {
  workingDirectory: string;
  name: string;
}): TestSuiteRow {
  return runTestSuiteCommand({ workingDirectory, args: ["create", name] }) as TestSuiteRow;
}

/** Reads a test suite by id or name, as the agent under test would see it. */
export function getTestSuite({
  workingDirectory,
  reference,
}: {
  workingDirectory: string;
  reference: string;
}): TestSuiteRow {
  return runTestSuiteCommand({ workingDirectory, args: ["get", reference] }) as TestSuiteRow;
}

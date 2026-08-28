import chalk from "chalk";
import type {
  RunPlanScope,
  RunPlanTarget,
} from "@/client-sdk/services/run-plans";
import type { TestSuitesApiService } from "@/client-sdk/services/test-suites";
import {
  resolveSuiteReference,
  SuiteReferenceError,
} from "../test-suites/resolveSuite";

/** The four scope flags a run takes. They answer one question, so only one may be given. */
export interface ScopeOptions {
  all?: boolean;
  testSuite?: string[];
  label?: string[];
  scenario?: string[];
}

/** What a run covers, plus the scenario ids a `scenarios` scope carries. */
export interface ResolvedScope {
  scope: RunPlanScope;
  scenarioIds?: string[];
}

/**
 * Reads the scope flags into the value the API takes.
 *
 * The four flags answer the same question, so naming more than one is a
 * refusal rather than a merge: a run covers one rule. Naming none is a refusal
 * too, because the alternative is running the whole project by accident. A
 * `--test-suite` value is resolved through the test suite list, so a name
 * reads as well as an id.
 *
 * @see specs/features/run-plan-cli.feature
 */
export async function buildScope(
  options: ScopeOptions,
  service?: TestSuitesApiService,
): Promise<ResolvedScope> {
  const chosen = [
    options.all ? "--all" : null,
    options.testSuite?.length ? "--test-suite" : null,
    options.label?.length ? "--label" : null,
    options.scenario?.length ? "--scenario" : null,
  ].filter((flag): flag is string => flag !== null);

  if (chosen.length === 0) {
    console.error(
      chalk.red(
        "Error: say what to run with one of --all, --test-suite, --label or --scenario.",
      ),
    );
    process.exit(1);
  }

  if (chosen.length > 1) {
    console.error(
      chalk.red(
        `Error: a run covers one rule, so ${chosen.join(" and ")} cannot be given together.`,
      ),
    );
    process.exit(1);
  }

  if (options.all) return { scope: { mode: "all" } };

  if (options.label?.length) {
    return {
      scope: {
        mode: "labels",
        labels: options.label.map((label) => label.trim()),
      },
    };
  }

  if (options.scenario?.length) {
    return {
      scope: { mode: "scenarios" },
      scenarioIds: options.scenario.map((id) => id.trim()),
    };
  }

  const testSuiteIds: string[] = [];
  for (const reference of options.testSuite ?? []) {
    try {
      const suite = await resolveSuiteReference({ reference, service });
      testSuiteIds.push(suite.id);
    } catch (error) {
      if (error instanceof SuiteReferenceError) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
      throw error;
    }
  }
  return { scope: { mode: "test_suites", testSuiteIds } };
}

/** How a scope reads on one line of the command output. */
export function describeScope(scope: RunPlanScope | null | undefined): string {
  if (!scope || scope.mode === "scenarios") return "the scenarios listed";
  if (scope.mode === "all") return "all scenarios";
  if (scope.mode === "test_suites")
    return `${scope.testSuiteIds.length} test suite${scope.testSuiteIds.length === 1 ? "" : "s"}`;
  return `labels: ${scope.labels.join(", ")}`;
}

/** The target types a run may go against. */
const TARGET_TYPES = ["prompt", "http", "code", "workflow"] as const;

/**
 * Reads the repeatable `--target <type>:<referenceId>` flag.
 *
 * A run with no target has nothing to run against, so an empty list is a
 * refusal rather than a request the platform answers with a 422.
 */
export function parseTargets(targetStrings: string[] | undefined): RunPlanTarget[] {
  if (!targetStrings || targetStrings.length === 0) {
    console.error(
      chalk.red(
        "Error: --target is required. Give at least one, as <type>:<referenceId> (for example http:agent_abc123).",
      ),
    );
    process.exit(1);
  }

  return targetStrings.map((value) => {
    const colonIndex = value.indexOf(":");
    if (colonIndex === -1) {
      console.error(
        chalk.red(
          `Error: invalid target "${value}". Use <type>:<referenceId>, for example http:agent_abc123.`,
        ),
      );
      process.exit(1);
    }
    const type = value.slice(0, colonIndex);
    const referenceId = value.slice(colonIndex + 1);
    if (!TARGET_TYPES.includes(type as (typeof TARGET_TYPES)[number])) {
      console.error(
        chalk.red(
          `Error: invalid target type "${type}". It must be one of: ${TARGET_TYPES.join(", ")}.`,
        ),
      );
      process.exit(1);
    }
    return { type: type as RunPlanTarget["type"], referenceId };
  });
}

/**
 * Reads the `--repeat <n>` flag.
 *
 * The platform takes 1 to 5, so a value outside that ends the command before
 * anything is scheduled.
 */
export function parseRepeat(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const repeat = Number.parseInt(value, 10);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) {
    console.error(
      chalk.red(`Error: --repeat takes a whole number from 1 to 5, not "${value}".`),
    );
    process.exit(1);
  }
  return repeat;
}

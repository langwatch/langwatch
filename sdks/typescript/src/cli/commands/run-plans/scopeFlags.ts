import chalk from "chalk";
import type {
  RunPlanScope,
  RunPlanTarget,
} from "@/client-sdk/services/run-plans";
import type { TestSuitesApiService } from "@/client-sdk/services/test-suites";
import {
  coerceParameterValue,
  type RunParameterValue,
} from "../../utils/keyValueFlags";
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

/**
 * The target types a run may go against. A `connected` target names an
 * agent by id, or by `<name>@<environment>`; the platform resolves the
 * second form, so it is passed through as the reference id.
 */
const TARGET_TYPES = [
  "prompt",
  "http",
  "code",
  "workflow",
  "connected",
] as const satisfies readonly RunPlanTarget["type"][];

const isTargetType = (value: string): value is RunPlanTarget["type"] =>
  (TARGET_TYPES as readonly string[]).includes(value);

/**
 * A target as the command line writes it: what to run against, plus the
 * parameter values that target alone runs with.
 *
 * The overrides are typed here rather than taken from the generated REST types
 * so the parser states its own contract; the platform merges them over the
 * run-level `--param` values, and the target wins.
 */
export type ParsedRunTarget = RunPlanTarget & {
  runParameters?: Record<string, RunParameterValue>;
};

const rejectTarget = (message: string): never => {
  console.error(chalk.red(`Error: ${message}`));
  process.exit(1);
};

/** Percent-decode one half of a query pair, naming the target when it cannot be read. */
function decodeQueryPart({
  part,
  target,
}: {
  part: string;
  target: string;
}): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return rejectTarget(
      `invalid target "${target}": "${part}" is not a valid percent-encoded value.`,
    );
  }
}

/**
 * Reads the `?k=v&k2=v2` suffix of one target into the values that target runs
 * with.
 *
 * The grammar is a query string, so `&` separates pairs and both halves are
 * percent-decoded. A value is read as the type it looks like, the same rule
 * `--param` uses, and a name repeated inside one suffix keeps the last value.
 */
function parseTargetParameters({
  query,
  target,
}: {
  query: string;
  target: string;
}): Record<string, RunParameterValue> {
  if (query === "") {
    rejectTarget(
      `invalid target "${target}": the question mark carries no parameters. Write it as ${target}model=gpt-5, or leave the question mark out.`,
    );
  }
  // A Map, not an object literal: assigning `__proto__` on a literal runs the
  // prototype setter, which drops the pair without a word instead of sending
  // the name the platform would refuse.
  const parsed = new Map<string, RunParameterValue>();
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      rejectTarget(
        `invalid target parameter "${pair}" in "${target}". Write each one as key=value, separated by &.`,
      );
    }
    const key = decodeQueryPart({ part: pair.slice(0, separator), target });
    const value = decodeQueryPart({ part: pair.slice(separator + 1), target });
    parsed.set(key, coerceParameterValue(value));
  }
  return Object.fromEntries(parsed);
}

/**
 * Reads the repeatable `--target <type>:<referenceId>[?k=v&k2=v2]` flag.
 *
 * A run with no target has nothing to run against, so an empty list is a
 * refusal rather than a request the platform answers with a 422.
 *
 * The suffix is what makes a comparison run possible: the same agent named
 * twice with different parameters is two targets, and the results show one
 * column for each. The question mark is the separator, so a reference id or a
 * value that holds one is refused by name rather than split in the wrong
 * place.
 *
 * @see specs/features/run-plan-cli.feature
 */
export function parseTargets(
  targetStrings: string[] | undefined,
): ParsedRunTarget[] {
  if (!targetStrings || targetStrings.length === 0) {
    console.error(
      chalk.red(
        "Error: --target is required. Give at least one, as <type>:<referenceId> (for example connected:agent_abc123 or connected:support-agent@production).",
      ),
    );
    process.exit(1);
  }

  return targetStrings.map((value) => {
    const colonIndex = value.indexOf(":");
    if (colonIndex === -1) {
      console.error(
        chalk.red(
          `Error: invalid target "${value}". Use <type>:<referenceId>, for example connected:agent_abc123 or connected:support-agent@production.`,
        ),
      );
      process.exit(1);
    }
    const type = value.slice(0, colonIndex);
    const rest = value.slice(colonIndex + 1);
    if (!isTargetType(type)) {
      console.error(
        chalk.red(
          `Error: invalid target type "${type}". It must be one of: ${TARGET_TYPES.join(", ")}.`,
        ),
      );
      process.exit(1);
    }

    const questionIndex = rest.indexOf("?");
    if (questionIndex === -1) {
      return {
        type,
        referenceId: decodeQueryPart({ part: rest, target: value }),
      };
    }

    // Decoded, because the refusal below tells a reader to write a question
    // mark in a reference id as %3F. Handing that back undecoded would send
    // the platform a reference id nothing resolves.
    const referenceId = decodeQueryPart({
      part: rest.slice(0, questionIndex),
      target: value,
    });
    const query = rest.slice(questionIndex + 1);
    if (query.includes("?")) {
      rejectTarget(
        `invalid target "${value}": a reference id or a value that holds a question mark must percent-encode it as %3F.`,
      );
    }
    return {
      type,
      referenceId,
      runParameters: parseTargetParameters({ query, target: value }),
    };
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

import chalk from "chalk";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { resolveFolderReference } from "./folders/resolveFolder";

/** What a run plan covers, as the API takes it. */
export type SuiteScope =
  | { mode: "all" }
  | { mode: "folders"; folderIds: string[] }
  | { mode: "labels"; labels: string[] }
  | { mode: "cases" };

/** The scope flags the suite write commands share. */
export type ScopeOptions = {
  scopeAll?: boolean;
  scopeFolder?: string[];
  scopeLabel?: string[];
};

/** True when the caller asked for a scope at all. */
export function hasScopeFlag(options: ScopeOptions): boolean {
  return (
    !!options.scopeAll ||
    (options.scopeFolder?.length ?? 0) > 0 ||
    (options.scopeLabel?.length ?? 0) > 0
  );
}

/**
 * Reads the scope flags into the value the API stores.
 *
 * The three flags answer the same question, so naming more than one is a
 * refusal rather than a merge: a plan covers one rule. A `--scope-folder`
 * value is resolved through the folder list, so a name reads as well as an id.
 *
 * Returns undefined when no scope flag was given, which leaves the plan
 * covering the test cases it names.
 *
 * @see specs/suites/run-plan-dynamic-scopes.feature
 */
export async function buildScope(
  options: ScopeOptions,
  service?: SuitesApiService,
): Promise<SuiteScope | undefined> {
  const chosen = [
    options.scopeAll ? "--scope-all" : null,
    options.scopeFolder?.length ? "--scope-folder" : null,
    options.scopeLabel?.length ? "--scope-label" : null,
  ].filter((flag): flag is string => flag !== null);

  if (chosen.length === 0) return undefined;
  if (chosen.length > 1) {
    console.error(
      chalk.red(
        `Error: a run plan covers one rule, so ${chosen.join(" and ")} cannot be given together.`,
      ),
    );
    process.exit(1);
  }

  if (options.scopeAll) return { mode: "all" };

  if (options.scopeLabel?.length) {
    return {
      mode: "labels",
      labels: options.scopeLabel.map((label) => label.trim()),
    };
  }

  const suitesService = service ?? new SuitesApiService();
  const folderIds: string[] = [];
  for (const reference of options.scopeFolder ?? []) {
    const folder = await resolveFolderReference({
      reference,
      service: suitesService,
    });
    folderIds.push(folder.id);
  }
  return { mode: "folders", folderIds };
}

/** How a stored scope reads on one line of the command output. */
export function describeScope(scope: SuiteScope | null | undefined): string {
  if (!scope || scope.mode === "cases") return "the test cases listed";
  if (scope.mode === "all") return "all test cases";
  if (scope.mode === "folders")
    return `${scope.folderIds.length} test suite(s)`;
  return `labels: ${scope.labels.join(", ")}`;
}

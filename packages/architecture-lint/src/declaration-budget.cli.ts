import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  DECLARATION_BUDGET_FILE,
  judgeDeclarationBudget,
  readDeclarationBudgets,
  readFileCount,
  type BudgetVerdict,
  type DeclarationBudget,
} from "./declaration-budget.ts";

/**
 * Measures each application's declaration count and holds it to the committed
 * budget.
 *
 * `--listFilesOnly` is deliberate: the program is built and its files resolved,
 * nothing is checked. That is the whole of what the budget is about and it
 * costs about four seconds an application rather than the minute a real check
 * takes — still too much to hang off `typecheck`, which is why this is its own
 * command.
 */

function measure(root: string, budget: DeclarationBudget): number | undefined {
  const run = spawnSync(
    "pnpm",
    ["-s", "exec", "tsc", "-p", budget.project, "--listFilesOnly", "--extendedDiagnostics"],
    {
      cwd: resolve(root, budget.directory),
      encoding: "utf8",
      // `--listFilesOnly` prints every resolved path, which is well past the
      // default 1 MiB for an application. A truncated run loses the `Files:`
      // line and reads as unmeasured.
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return readFileCount(`${run.stdout ?? ""}\n${run.stderr ?? ""}`);
}

function describe(verdict: BudgetVerdict): string {
  if (verdict.state === "within") {
    return `  ok   ${verdict.package}: ${verdict.files} files, budget ${verdict.budget}`;
  }
  return `  FAIL ${verdict.message}`;
}

const rootFlag = process.argv.indexOf("--root");
const root = resolve(rootFlag === -1 ? "." : (process.argv[rootFlag + 1] ?? "."));

const { budgets, measured } = readDeclarationBudgets(root);
console.log(`Declaration-file budgets (${DECLARATION_BUDGET_FILE}, measured ${measured}):`);

const verdicts = budgets.map((budget) => judgeDeclarationBudget(budget, measure(root, budget)));
for (const verdict of verdicts) console.log(describe(verdict));

const failed = verdicts.filter((verdict) => verdict.state !== "within");
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${verdicts.length} packages are over budget.`);
  process.exit(1);
}
console.log(`\nAll ${verdicts.length} packages are within budget.`);

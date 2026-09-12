import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * How many declaration files each application loads to type-check itself.
 *
 * `Files:` from `--extendedDiagnostics` is the number that tracks the cost:
 * loading them is the single largest bucket in a run, larger than checking
 * expressions. It is also the number that catches an import nobody meant to
 * make — one `better-auth/react` in a browser module put 251 kysely
 * declarations into `apps/ui`, and nothing said so for months, because the
 * only symptom was a slower check.
 *
 * The budget is not a target to grow into. It is today's count with a little
 * headroom, and raising it is a decision somebody writes a reason for.
 */

const budgetSchema = z
  .object({
    version: z.literal(0),
    measured: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    budgets: z.array(
      z
        .object({
          package: z.string(),
          directory: z.string(),
          project: z.string(),
          files: z.number().int().positive(),
          measuredFiles: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();

export type DeclarationBudgets = z.infer<typeof budgetSchema>;
export type DeclarationBudget = DeclarationBudgets["budgets"][number];

export const DECLARATION_BUDGET_FILE = "packages/architecture-enforcer/src/declaration-budget.json";

/** The committed budgets, read from the file that carries them. */
export function readDeclarationBudgets(root: string): DeclarationBudgets {
  const path = join(root, DECLARATION_BUDGET_FILE);
  return budgetSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

const FILES_LINE = /^Files:\s+(\d+)\s*$/m;

/**
 * The `Files:` count out of one `--extendedDiagnostics` run, or `undefined`
 * when the output does not carry one — a compiler that failed to start says
 * nothing, and reading that as zero would report every budget as met.
 */
export function readFileCount(diagnostics: string): number | undefined {
  const stripped = diagnostics.replace(/\[[0-9;]*m/g, "");
  const match = FILES_LINE.exec(stripped);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

export type BudgetVerdict =
  | { package: string; state: "within"; files: number; budget: number }
  | { package: string; state: "over"; files: number; budget: number; message: string }
  | { package: string; state: "unmeasured"; budget: number; message: string };

/** One package's verdict, given what its run reported. */
export function judgeDeclarationBudget(
  budget: DeclarationBudget,
  files: number | undefined,
): BudgetVerdict {
  if (files === undefined) {
    return {
      budget: budget.files,
      message: `${budget.package} reported no \`Files:\` line, so its declaration count is unknown. Run \`tsc -p ${budget.project} --listFilesOnly --extendedDiagnostics\` in ${budget.directory} and read the error it prints.`,
      package: budget.package,
      state: "unmeasured",
    };
  }

  if (files > budget.files) {
    return {
      budget: budget.files,
      files,
      message: `${budget.package} now loads ${files} declaration files, ${files - budget.files} more than its budget of ${budget.files}. Find the new import with \`tsc -p ${budget.project} --listFiles\` in ${budget.directory}, or raise the budget in ${DECLARATION_BUDGET_FILE} with the reason.`,
      package: budget.package,
      state: "over",
    };
  }

  return { budget: budget.files, files, package: budget.package, state: "within" };
}

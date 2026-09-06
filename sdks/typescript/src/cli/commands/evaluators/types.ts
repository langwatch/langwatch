import chalk from "chalk";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { evaluatorTypeCatalog } from "./catalog";

/**
 * Lists every evaluator type `evaluator create --type` (and the platform's
 * create route) accepts. Reads the catalog embedded at build — no API call
 * and no API key, so the answer is there even before login. Returns the
 * listing rather than printing it: the output port renders it in whatever
 * format the caller asked for (utils/output.ts).
 */
export const listEvaluatorTypesCommand = (): CommandResult => {
  const entries = evaluatorTypeCatalog();

  return {
    data: entries,
    table: () => {
      console.log();

      formatTable({
        data: entries.map((entry) => ({
          Type: entry.slug,
          Name: entry.name,
          Category: entry.category,
          Guardrail: entry.isGuardrail ? "yes" : chalk.gray("—"),
        })),
        headers: ["Type", "Name", "Category", "Guardrail"],
        colorMap: {
          Type: chalk.cyan,
          Category: chalk.yellow,
        },
      });

      console.log();
      console.log(
        chalk.gray(
          `Use ${chalk.cyan('langwatch evaluator create "My Evaluator" --type <type>')} to create one`,
        ),
      );
    },
  };
};

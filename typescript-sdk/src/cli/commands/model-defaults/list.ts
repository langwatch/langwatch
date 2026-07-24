import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";

import { ModelDefaultsApiService } from "@/client-sdk/services/model-defaults/model-defaults-api.service";

import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the snapshot rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). `data` is the whole
 * snapshot — effective resolution, configs AND the scope block the human view
 * only shows in its spinner line.
 */
export const listModelDefaultsCommand = async (): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new ModelDefaultsApiService();
  const spinner = createSpinner("Fetching default-model configuration...").start();

  try {
    const snapshot = await service.getSnapshot();

    spinner.succeed(
      `Default-model snapshot for project ${chalk.cyan(snapshot.scope.projectId)}`,
    );

    return {
      data: snapshot,
      table: () => {
        console.log();
        console.log(chalk.bold("Effective resolution"));
        const effectiveRows = (
          ["DEFAULT", "FAST", "EMBEDDINGS"] as const
        ).map((role) => {
          const hit = snapshot.effective[role];
          return {
            Role: role,
            Model: hit ? chalk.green(hit.model) : chalk.gray("(unresolved)"),
            From: hit?.scope ?? chalk.gray("—"),
            Source: hit?.source ?? chalk.gray("—"),
          };
        });
        formatTable({
          data: effectiveRows,
          headers: ["Role", "Model", "From", "Source"],
        });

        console.log();
        console.log(chalk.bold(`Configs (${snapshot.configs.length})`));
        if (snapshot.configs.length === 0) {
          console.log(
            chalk.gray(
              "  No configs at any readable scope. Set one with:",
            ),
          );
          console.log(
            chalk.cyan("    langwatch model-default set DEFAULT openai/gpt-5"),
          );
          console.log();
          return;
        }

        for (const c of snapshot.configs) {
          const scopesStr = c.scopes
            .map((s) => `${s.type.toLowerCase()}:${s.name}`)
            .join(", ");
          console.log();
          console.log(`  ${chalk.gray("ID:")}     ${chalk.green(c.id)}`);
          console.log(`  ${chalk.gray("Scopes:")} ${scopesStr}`);
          console.log(`  ${chalk.gray("Keys:")}`);
          for (const [key, value] of Object.entries(c.config)) {
            console.log(`    ${chalk.cyan(key.padEnd(20))} ${value}`);
          }
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch default models" });
    process.exit(1);
  }
};

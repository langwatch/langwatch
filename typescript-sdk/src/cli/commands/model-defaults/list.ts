import chalk from "chalk";
import ora from "ora";

import { ModelDefaultsApiService } from "@/client-sdk/services/model-defaults/model-defaults-api.service";

import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

export const listModelDefaultsCommand = async (options?: {
  format?: string;
}): Promise<void> => {
  checkApiKey();

  const service = new ModelDefaultsApiService();
  const spinner = ora("Fetching default-model configuration...").start();

  try {
    const snapshot = await service.getSnapshot();

    spinner.succeed(
      `Default-model snapshot for project ${chalk.cyan(snapshot.scope.projectId)}`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }

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
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch default models" });
    process.exit(1);
  }
};

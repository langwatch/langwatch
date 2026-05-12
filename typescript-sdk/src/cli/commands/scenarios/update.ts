import chalk from "chalk";
import ora from "ora";
import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import type { UpdateScenarioBody } from "@/client-sdk/services/scenarios";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const updateScenarioCommand = async (
  id: string,
  options: { name?: string; situation?: string; criteria?: string; labels?: string; format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new ScenariosApiService();
  const spinner = ora(`Updating scenario "${id}"...`).start();

  try {
    const body: UpdateScenarioBody = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.situation !== undefined) body.situation = options.situation;
    if (options.criteria !== undefined)
      body.criteria = options.criteria.split(",").map((c) => c.trim());
    if (options.labels !== undefined)
      body.labels = options.labels.split(",").map((l) => l.trim());

    const scenario = await service.update(id, body);

    spinner.succeed(
      `Updated scenario "${chalk.cyan(scenario.name)}" ${chalk.gray(`(id: ${scenario.id})`)}`,
    );

    if (options.format === "json") {
      console.log(JSON.stringify(scenario, null, 2));
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "update scenario" });
    process.exit(1);
  }
};

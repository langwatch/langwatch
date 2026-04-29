import ora from "ora";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const updateTriggerCommand = async (
  id: string,
  options: {
    name?: string;
    active?: string;
    message?: string;
    alertType?: string;
    format?: string;
  },
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Updating trigger "${id}"...`).start();

  try {
    const body: Record<string, unknown> = {};
    if (options.name) body.name = options.name;
    if (options.active !== undefined) body.active = options.active === "true";
    if (options.message !== undefined) body.message = options.message || null;
    if (options.alertType) body.alertType = options.alertType;

    if (Object.keys(body).length === 0) {
      spinner.fail("No fields to update. Use --name, --active, --message, or --alert-type.");
      process.exit(1);
    }

    const trigger = (await apiRequest({
      method: "PATCH",
      path: `/api/triggers/${encodeURIComponent(id)}`,
      apiKey,
      endpoint,
      body,
    })) as { id: string; name: string; active: boolean };
    spinner.succeed(`Trigger "${trigger.name}" updated`);

    if (options.format === "json") {
      console.log(JSON.stringify(trigger, null, 2));
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "update trigger" });
    process.exit(1);
  }
};

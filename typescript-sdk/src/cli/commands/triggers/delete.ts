import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";

export const deleteTriggerCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Deleting trigger "${id}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/triggers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to delete trigger "${id}": ${message}`);
      process.exit(1);
    }

    const result = await response.json() as { id: string; deleted: boolean };
    spinner.succeed(`Trigger "${id}" deleted`);

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "delete trigger" });
    process.exit(1);
  }
};

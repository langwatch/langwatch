import ora from "ora";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const deleteGraphCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Deleting graph "${id}"...`).start();

  try {
    let result: { id: string; deleted: boolean };
    try {
      result = (await apiRequest({
        method: "DELETE",
        path: `/api/graphs/${encodeURIComponent(id)}`,
        apiKey,
        endpoint,
      })) as { id: string; deleted: boolean };
    } catch (httpError) {
      const message = httpError instanceof Error ? httpError.message : String(httpError);
      spinner.fail(`Failed to delete graph "${id}": ${message}`);
      process.exit(1);
    }
    spinner.succeed(`Graph "${id}" deleted`);

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "delete graph" });
    process.exit(1);
  }
};

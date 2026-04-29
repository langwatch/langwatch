import ora from "ora";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const deleteSecretCommand = async (
  id: string,
  options?: { format?: string }
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Deleting secret "${id}"...`).start();

  try {
    const result = (await apiRequest({
      method: "DELETE",
      path: `/api/secrets/${id}`,
      apiKey,
      endpoint,
    })) as {
      id: string;
      deleted: boolean;
    };

    spinner.succeed(`Secret deleted (${result.id})`);

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "delete secret" });
    process.exit(1);
  }
};

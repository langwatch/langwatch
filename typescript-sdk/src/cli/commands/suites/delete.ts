import ora from "ora";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const deleteSuiteCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new SuitesApiService();
  const spinner = ora(`Archiving suite "${id}"...`).start();

  try {
    const result = await service.delete(id);

    spinner.succeed(`Suite "${id}" archived`);

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "delete suite" });
    process.exit(1);
  }
};

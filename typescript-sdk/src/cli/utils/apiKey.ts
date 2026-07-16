import chalk from "chalk";
import { config } from "dotenv";
import { getEndpoint } from "./endpoint";
import { getOutputFormat, renderErrorAsJson } from "./errorOutput";

export const checkApiKey = (): void => {
  // Load environment variables from .env file
  config({ quiet: true });

  const apiKey = process.env.LANGWATCH_API_KEY;

  if (!apiKey || apiKey.trim() === "") {
    const authUrl = `${getEndpoint()}/authorize`;

    // Machine callers (`--format json`) get the structured document on stdout,
    // same contract as every other failure: a `kind` to match on beats prose.
    if (getOutputFormat() === "json") {
      console.log(
        renderErrorAsJson({
          kind: "missing_api_key",
          message:
            "LANGWATCH_API_KEY is not set. Run `langwatch login` or add it to your .env file.",
          httpStatus: 0,
          meta: { authUrl },
          isDomain: true,
        }),
      );
      console.error(chalk.red("Error: LANGWATCH_API_KEY not found."));
      process.exit(1);
    }

    console.error(chalk.red("Error: LANGWATCH_API_KEY not found."));
    console.error(chalk.gray("Get your API key from:"));
    console.error(chalk.cyan(`  ${authUrl}`));
    console.error(chalk.gray("Then either run:"));
    console.error(chalk.cyan("  langwatch login --api-key <your-key>"));
    console.error(chalk.gray("Or add it to your .env file:"));
    console.error(chalk.cyan("  echo 'LANGWATCH_API_KEY=<your-key>' >> .env"));
    process.exit(1);
  }
};

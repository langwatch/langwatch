import chalk from "chalk";
import { config } from "dotenv";
import { getEndpoint } from "./endpoint";

export const checkApiKey = (): void => {
  // Load environment variables from .env file
  config();

  const apiKey = process.env.LANGWATCH_API_KEY;

  if (!apiKey || apiKey.trim() === "") {
    const authUrl = `${getEndpoint()}/authorize`;
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
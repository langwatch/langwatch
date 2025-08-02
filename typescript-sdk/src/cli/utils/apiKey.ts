import chalk from "chalk";
import { config } from "dotenv";

export const checkApiKey = (): void => {
  // Load environment variables from .env file
  config();

  const apiKey = process.env.LANGWATCH_API_KEY;

  if (!apiKey || apiKey.trim() === "") {
    console.error(chalk.red("Error: LANGWATCH_API_KEY not found."));
    console.error(chalk.gray("Please add it to your environment variables or .env file:"));
    console.error(chalk.cyan("  echo 'LANGWATCH_API_KEY=your_api_key_here' >> .env"));
    process.exit(1);
  }
};
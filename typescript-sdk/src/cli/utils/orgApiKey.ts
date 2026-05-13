import chalk from "chalk";
import { config } from "dotenv";
import { getEndpoint } from "./endpoint";

export const checkOrgApiKey = (): string => {
  config();

  const orgKey = process.env.LANGWATCH_ORG_API_KEY;

  if (!orgKey || orgKey.trim() === "") {
    const authUrl = `${getEndpoint()}/authorize`;
    console.error(chalk.red("Error: LANGWATCH_ORG_API_KEY not found."));
    console.error(chalk.gray("This command requires an organization-level API key."));
    console.error(chalk.gray("Get one from:"));
    console.error(chalk.cyan(`  ${authUrl}`));
    console.error(chalk.gray("Then add it to your .env file:"));
    console.error(chalk.cyan("  echo 'LANGWATCH_ORG_API_KEY=<your-org-key>' >> .env"));
    process.exit(1);
  }

  return orgKey;
};

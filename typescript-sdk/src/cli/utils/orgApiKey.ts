import chalk from "chalk";
import { config } from "dotenv";
import { getEndpoint } from "./endpoint";

/**
 * Resolves an org-level API key with fallback chain:
 *   LANGWATCH_ORG_API_KEY → LANGWATCH_API_KEY → error with helpful message
 *
 * When falling back to LANGWATCH_API_KEY, emits a warning since project-scoped
 * keys may lack org-level permissions and the server will reject with 401/403.
 */
export const checkOrgApiKey = (): string => {
  config();

  const orgKey = process.env.LANGWATCH_ORG_API_KEY;
  if (orgKey && orgKey.trim() !== "") {
    return orgKey.trim();
  }

  const projectKey = process.env.LANGWATCH_API_KEY;
  if (projectKey && projectKey.trim() !== "") {
    console.error(
      chalk.yellow("Warning: LANGWATCH_ORG_API_KEY not set, falling back to LANGWATCH_API_KEY."),
    );
    console.error(
      chalk.yellow("This may fail if the key lacks organization-level permissions."),
    );
    return projectKey.trim();
  }

  const authUrl = `${getEndpoint()}/authorize`;
  console.error(chalk.red("Error: No API key found."));
  console.error(chalk.gray("This command requires an organization-level API key."));
  console.error(chalk.gray("Get one from:"));
  console.error(chalk.cyan(`  ${authUrl}`));
  console.error(chalk.gray("Then add it to your .env file:"));
  console.error(chalk.cyan("  echo 'LANGWATCH_ORG_API_KEY=<your-org-key>' >> .env"));
  console.error(chalk.gray("Or fall back to a project key (limited permissions):"));
  console.error(chalk.cyan("  echo 'LANGWATCH_API_KEY=<your-key>' >> .env"));
  process.exit(1);
};

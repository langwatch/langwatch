import chalk from "chalk";
import { config } from "dotenv";
import { getEndpoint } from "./endpoint";
import { getOutputFormat, renderErrorAsJson } from "./errorOutput";

/**
 * Re-read the caller's .env, applying only the LANGWATCH_* keys.
 *
 * In-process this is mostly a no-op (index.ts already ran a full
 * `dotenv.config()` at boot — that path is untouched). Under the daemon it
 * runs per request, against the CALLER's cwd, in a long-lived shared process:
 * loading the whole file the way `dotenv.config()` does would stuff unrelated
 * secrets (DATABASE_URL, AWS credentials, …) into that process's memory for
 * every later request to potentially see, contradicting the
 * secret-minimisation the request env allowlist (daemon/eligibility.ts
 * collectForwardedEnv) is built on. The caller's .env therefore contributes
 * the same class of variables the allowlist would have forwarded: the
 * LANGWATCH_* ones — which covers everything the CLI itself reads
 * (LANGWATCH_API_KEY, LANGWATCH_ENDPOINT, LANGWATCH_PROJECT_ID, …).
 *
 * dotenv semantics are preserved: a variable that is already set (the
 * baseline, or the caller's forwarded overlay) is never overwritten.
 */
const loadEnvFileScoped = (): void => {
  // `processEnv: {}` parses the file into a throwaway object instead of
  // straight into process.env, so the filter below decides what lands.
  const parsed = config({ quiet: true, processEnv: {} })?.parsed ?? {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith("LANGWATCH_")) continue;
    // dotenv semantics: an already-set variable is never overwritten.
    process.env[key] ??= value;
  }
};

export const checkApiKey = (): void => {
  // Load environment variables from .env file (scoped — see above)
  loadEnvFileScoped();

  const apiKey = process.env.LANGWATCH_API_KEY;

  if (!apiKey || apiKey.trim() === "") {
    const authUrl = `${getEndpoint()}/authorize`;

    // Machine callers (`-o json`, agent mode) get the structured document on
    // stdout, same contract as every other failure: a `code` to match on beats
    // prose.
    if (getOutputFormat() !== "text") {
      console.log(
        renderErrorAsJson({
          code: "missing_api_key",
          kind: "missing_api_key",
          message:
            "LANGWATCH_API_KEY is not set. Run `langwatch login` or add it to your .env file.",
          httpStatus: 0,
          meta: { authUrl },
          isHandled: true,
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

/**
 * Org-anchored surfaces (webhooks, spend-events) authenticate with an
 * ORGANIZATION API key (sk-lw-*), not a project key. Resolution:
 * LANGWATCH_ORG_API_KEY wins; LANGWATCH_API_KEY is accepted as a fallback
 * for callers who keep their org key there (the server rejects
 * project-scoped keys on these routes with a 401 either way). Returns the
 * resolved key so services can be constructed with it explicitly.
 */
export const checkOrgApiKey = (): string => {
  loadEnvFileScoped();

  // Empty strings count as absent (?? alone would accept an empty var and
  // then fail the presence check below without ever trying the fallback).
  const firstNonEmpty = (...values: Array<string | undefined>): string | undefined =>
    values.find((v) => v !== undefined && v.trim() !== "");
  const orgKey = firstNonEmpty(
    process.env.LANGWATCH_ORG_API_KEY,
    process.env.LANGWATCH_API_KEY,
  );
  if (orgKey) return orgKey;

  const settingsUrl = `${getEndpoint()}/settings/api-keys`;
  if (getOutputFormat() !== "text") {
    console.log(
      renderErrorAsJson({
        code: "missing_org_api_key",
        kind: "missing_api_key",
        message:
          "LANGWATCH_ORG_API_KEY is not set. Create an organization API key in Settings > API Keys and add it to your .env file.",
        httpStatus: 0,
        meta: { settingsUrl },
        isHandled: true,
      }),
    );
    console.error(chalk.red("Error: LANGWATCH_ORG_API_KEY not found."));
    process.exit(1);
  }

  console.error(chalk.red("Error: LANGWATCH_ORG_API_KEY not found."));
  console.error(chalk.gray("This command needs an ORGANIZATION API key (sk-lw-...). Create one at:"));
  console.error(chalk.cyan(`  ${settingsUrl}`));
  console.error(chalk.gray("Then add it to your .env file:"));
  console.error(chalk.cyan("  echo 'LANGWATCH_ORG_API_KEY=<your-key>' >> .env"));
  process.exit(1);
};

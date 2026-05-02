import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";
import { getEndpoint } from "@/cli/utils/endpoint";
import {
  startDeviceCode,
  pollUntilDone,
  DeviceFlowError,
} from "@/cli/utils/governance/device-flow";
import {
  loadConfig,
  saveConfig,
} from "@/cli/utils/governance/config";
import { formatLoginCeremony } from "@/cli/utils/governance/login-ceremony";
import {
  getCliBootstrap,
  type CliBootstrapResponse,
} from "@/cli/utils/governance/cli-api";

const updateEnvFile = (
  apiKey: string,
): { created: boolean; updated: boolean; path: string } => {
  const envPath = path.join(process.cwd(), ".env");

  // Check if .env exists
  if (!fs.existsSync(envPath)) {
    // Create new .env file
    fs.writeFileSync(envPath, `LANGWATCH_API_KEY=${apiKey}\n`);
    return { created: true, updated: false, path: envPath };
  }

  // Read existing .env file
  const content = fs.readFileSync(envPath, "utf-8");
  const lines = content.split("\n");

  // Check if LANGWATCH_API_KEY already exists and update it
  let found = false;
  const updatedLines = lines.map((line) => {
    if (line.startsWith("LANGWATCH_API_KEY=")) {
      found = true;
      return `LANGWATCH_API_KEY=${apiKey}`;
    }
    return line;
  });

  if (!found) {
    // Add to end of file
    if (content.endsWith("\n") || content === "") {
      updatedLines.push(`LANGWATCH_API_KEY=${apiKey}`);
    } else {
      updatedLines.push("", `LANGWATCH_API_KEY=${apiKey}`);
    }
  }

  fs.writeFileSync(envPath, updatedLines.join("\n"));
  return { created: false, updated: found, path: envPath };
};

export const loginCommand = async (
  options?: { apiKey?: string; device?: boolean; browser?: string },
): Promise<void> => {
  try {
    // Device-flow mode: SSO via the control plane's RFC 8628 endpoints,
    // mints a personal virtual key bound to the user. This is the
    // governance-plane onboarding for enterprise users, distinct from the
    // single-user API-key flow below.
    if (options?.device) {
      await loginDeviceFlow({ browser: options.browser });
      return;
    }

    // Non-interactive mode: --api-key flag provided
    if (options?.apiKey) {
      const apiKey = options.apiKey.trim();
      if (apiKey.length < 10) {
        console.error(chalk.red("Error: API key seems too short. Please check and try again."));
        process.exit(1);
      }

      const envResult = updateEnvFile(apiKey);
      console.log(chalk.green("API key saved successfully."));
      if (envResult.created) {
        console.log(chalk.gray(`Created .env file at ${envResult.path}`));
      } else if (envResult.updated) {
        console.log(chalk.gray(`Updated existing API key in ${envResult.path}`));
      } else {
        console.log(chalk.gray(`Added API key to ${envResult.path}`));
      }
      return;
    }

    // Interactive mode: open browser and prompt for key
    console.log(chalk.blue("🔐 LangWatch Login"));
    console.log(
      chalk.gray(
        "This will open your browser to get an API key from LangWatch.",
      ),
    );
    console.log();

    // Get the authorization URL
    const endpoint = getEndpoint();
    const authUrl = `${endpoint}/authorize`;

    console.log(chalk.cyan(`Opening: ${authUrl}`));

    // Open browser
    const spinner = ora("Opening browser...").start();

    try {
      const open = (await import("open")).default;
      await open(authUrl);
      spinner.succeed("Browser opened");
    } catch {
      spinner.fail("Failed to open browser");
      console.log(chalk.yellow(`Please manually open: ${chalk.cyan(authUrl)}`));
    }

    console.log();
    console.log(chalk.gray("1. Log in to LangWatch in your browser"));
    console.log(chalk.gray("2. Copy your API key"));
    console.log(chalk.gray("3. Come back here and paste it"));
    console.log();

    // Wait for user input using prompts library
    const response = await prompts({
      type: "password",
      name: "apiKey",
      message: "Paste your API key here:",
      validate: (value: string) => {
        if (!value || value.trim() === "") {
          return "API key is required";
        }
        if (value.length < 10) {
          return "API key seems too short. Please check and try again.";
        }
        return true;
      },
    });

    if (!response.apiKey) {
      console.log(chalk.yellow("Login cancelled"));
      process.exit(0);
    }

    const apiKey = response.apiKey.trim();

    // Save to .env file
    const envResult = updateEnvFile(apiKey);

    console.log();
    console.log(chalk.green("✓ API key saved successfully!"));

    if (envResult.created) {
      console.log(chalk.gray(`• Created .env file with your API key`));
    } else if (envResult.updated) {
      console.log(chalk.gray(`• Updated existing API key in .env file`));
    } else {
      console.log(chalk.gray(`• Added API key to existing .env file`));
    }

    console.log();
    console.log(chalk.green("🎉 You're all set! You can now use:"));
    console.log(chalk.cyan("  langwatch prompt add <name>"));
    console.log(chalk.cyan("  langwatch prompt sync"));
  } catch (error) {
    console.error(
      chalk.red(
        `Error during login: ${
          formatApiErrorMessage({ error })
        }`,
      ),
    );
    process.exit(1);
  }
};

/**
 * Device-flow (RFC 8628) login for the AI Gateway governance plane.
 *
 * Flow:
 *   1. POST /api/auth/cli/device-code → user_code + verification_uri
 *   2. open the verification_uri (or LANGWATCH_BROWSER override) in
 *      a browser, print the user_code to stdout for fallback paste
 *   3. poll /api/auth/cli/exchange until the user clicks Approve in
 *      the browser
 *   4. persist access_token + refresh_token + user/org/personal-VK
 *      to ~/.langwatch/config.json (mode 0600)
 *
 * Coexists with the API-key login above — `langwatch login --api-key`
 * is unchanged for power users who manage tokens manually.
 */
async function loginDeviceFlow(opts: { browser?: string }): Promise<void> {
  const cfg = loadConfig();
  const baseUrl = cfg.control_plane_url;

  console.log(chalk.blue("🔐 LangWatch governance login"));
  console.log(chalk.gray(`Control plane: ${baseUrl}`));

  const dc = await startDeviceCode({ baseUrl });
  const verifyURL = dc.verification_uri_complete ??
    `${dc.verification_uri.replace(/\/+$/, "")}?user_code=${encodeURIComponent(dc.user_code)}`;

  console.log();
  console.log(chalk.cyan(`Opening: ${verifyURL}`));
  console.log(chalk.gray(`If your browser doesn't open, paste the URL above and enter code: ${chalk.bold(dc.user_code)}`));
  console.log();

  await openInBrowser(verifyURL, opts.browser);

  const spinner = ora("Waiting for you to log in").start();
  try {
    const result = await pollUntilDone({ baseUrl }, dc);
    spinner.succeed(`Logged in as ${result.user.email}`);

    cfg.access_token = result.access_token;
    cfg.refresh_token = result.refresh_token;
    cfg.expires_at = Math.floor(Date.now() / 1000) + result.expires_in;
    cfg.user = { id: result.user.id, email: result.user.email, name: result.user.name };
    cfg.organization = {
      id: result.organization.id,
      slug: result.organization.slug,
      name: result.organization.name,
    };
    if (result.default_personal_vk) {
      cfg.default_personal_vk = {
        id: result.default_personal_vk.id,
        secret: result.default_personal_vk.secret,
        prefix: result.default_personal_vk.prefix,
      };
    }
    saveConfig(cfg);

    // Storyboard Screen 4 ceremony — provides the next-step affordance
    // for fresh CLI users (try-it commands + dashboard hint). When the
    // backend exposes /api/auth/cli/bootstrap (REST adapter over
    // api.user.cliBootstrap, Sergey 32cad11ae), the ceremony also lists
    // inherited providers + monthly budget. On older self-hosted
    // servers without the REST endpoint, fetchBootstrapSafely returns
    // null and the ceremony gracefully degrades to header + try-it
    // block + dashboard hint.
    const bootstrap = await fetchBootstrapSafely(cfg);
    console.log();
    const ceremonyLines = formatLoginCeremony({
      email: cfg.user?.email ?? result.user.email,
      organizationName: cfg.organization?.name,
      providers: bootstrap?.providers,
      budget: bootstrap?.budget?.monthlyLimitUsd != null
        ? {
            period: bootstrap.budget.period,
            limitUsd: bootstrap.budget.monthlyLimitUsd,
            usedUsd: bootstrap.budget.monthlyUsedUsd,
          }
        : undefined,
    });
    for (const line of ceremonyLines) {
      console.log(line);
    }
    console.log();
    console.log(chalk.gray(`  Gateway:   ${cfg.gateway_url}`));
    console.log(chalk.gray(`  Dashboard: ${cfg.control_plane_url}`));
  } catch (err) {
    spinner.fail();
    if (err instanceof DeviceFlowError) {
      switch (err.kind) {
        case "denied":
          throw new Error("authorization denied — you can retry `langwatch login --device`");
        case "expired":
          throw new Error("authorization request expired — run `langwatch login --device` again");
        default:
          throw err;
      }
    }
    throw err;
  }
}

/**
 * Best-effort fetch of the CLI bootstrap data (provider list + budget)
 * for Storyboard Screen 4 ceremony enrichment. Never throws — login
 * must succeed even if the backend is older / endpoint flaky / network
 * jitter. Returns null on any failure; the ceremony degrades to the
 * basic header + try-it block.
 */
async function fetchBootstrapSafely(
  cfg: ReturnType<typeof loadConfig>,
): Promise<CliBootstrapResponse | null> {
  try {
    return await getCliBootstrap(cfg);
  } catch {
    return null;
  }
}

/**
 * Open `url` in a browser, honouring LANGWATCH_BROWSER (and BROWSER as
 * a secondary fallback) so dogfood / screenshot runs can pin a
 * controllable browser like Chrome even when the OS default is
 * Firefox or Safari.
 *
 * Special value "none" suppresses launcher entirely (CLI prints the
 * URL — useful for headless CI / SSH sessions).
 */
async function openInBrowser(url: string, override?: string): Promise<void> {
  const choice = override ?? process.env.LANGWATCH_BROWSER ?? process.env.BROWSER ?? "";
  if (choice === "none") return;
  const open = (await import("open")).default;
  try {
    if (!choice || choice === "default") {
      await open(url);
      return;
    }
    // open() accepts an `app` option; map common names to the open lib's expected shape.
    await open(url, { app: { name: choice } });
  } catch {
    // Don't fail login because the browser couldn't open — the user
    // can paste the URL manually. Keep the error silent; the spinner
    // following will keep them informed.
  }
}

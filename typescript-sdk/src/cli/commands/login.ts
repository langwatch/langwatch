import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { getEndpoint } from "../../client";

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

export const loginCommand = async (): Promise<void> => {
  try {
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
    } catch (error) {
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
          error instanceof Error ? error.message : "Unknown error"
        }`,
      ),
    );
    process.exit(1);
  }
};

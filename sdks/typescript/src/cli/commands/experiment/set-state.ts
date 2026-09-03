import { readFile } from "node:fs/promises";
import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  ExperimentsApiService,
  type ExperimentWorkbenchState,
} from "@/client-sdk/services/experiments/experiments-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { parsePositiveIntOrNull } from "../../utils/positiveInt";
import type { CommandResult } from "../../utils/output";

export interface ExperimentSetStateOptions {
  file?: string;
  expectedVersion?: string;
  message?: string;
}

/** Everything on stdin, for `--file -`. */
const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const readState = async (file: string): Promise<ExperimentWorkbenchState> => {
  const raw = file === "-" ? await readStdin() : await readFile(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      file === "-"
        ? "The setup read from stdin is not valid JSON"
        : `The setup in ${file} is not valid JSON`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("The setup must be a JSON object");
  }
  return parsed as ExperimentWorkbenchState;
};

export const experimentSetStateCommand = async (
  slug: string,
  options: ExperimentSetStateOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const spinner = createSpinner(`Saving setup for "${slug}"...`).start();

  try {
    if (!options.file) {
      throw new Error(
        "Pass --file <path> with the setup to save, or --file - to read it from stdin.",
      );
    }

    const state = await readState(options.file);

    const expectedVersion = (() => {
      if (options.expectedVersion === undefined) return undefined;
      const parsed = parsePositiveIntOrNull(options.expectedVersion);
      if (parsed === null) {
        // Guessing here would write on top of a version the caller never named,
        // which is the exact collision --expected-version exists to prevent.
        throw new Error(
          `--expected-version takes a version number, like 3. Got "${options.expectedVersion}".`,
        );
      }
      return parsed;
    })();

    const service = new ExperimentsApiService();
    const saved = await service.setWorkbenchState({
      slug,
      state,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      ...(options.message ? { commitMessage: options.message } : {}),
    });

    spinner.succeed(`"${slug}" saved at version ${chalk.cyan(saved.version)}`);

    return {
      data: { slug, ...saved },
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("Slug:")}    ${chalk.green(slug)}`);
        console.log(`  ${chalk.gray("Version:")} ${saved.version}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "save experiment setup" });
    process.exit(1);
  }
};

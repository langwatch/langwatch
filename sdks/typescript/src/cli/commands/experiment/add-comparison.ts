import chalk from "chalk";
import ora from "ora";
import {
  ExperimentsApiService,
  type ComparisonVariantSpec,
} from "@/client-sdk/services/experiments/experiments-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Parses a `--variant` flag value into the shape the attach-comparison
 * endpoint expects.
 *
 * - `target:<id>`           references a target already in the experiment
 * - `prompt:<handle>`       reuses/creates a prompt target for that handle
 * - `prompt:<handle>@<n>`   pins a specific prompt version
 * - `agent:<id>`            reuses/creates an agent target for that agent id
 */
export const parseVariantSpec = (raw: string): ComparisonVariantSpec => {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex === -1) {
    throw new Error(
      `Invalid --variant "${raw}". Expected target:<id>, prompt:<handle>, or agent:<id>.`,
    );
  }
  const kind = raw.slice(0, separatorIndex);
  const rest = raw.slice(separatorIndex + 1);

  if (kind === "target") {
    if (!rest) throw new Error(`Invalid --variant "${raw}": missing target id`);
    return { kind: "existingTarget", targetId: rest };
  }
  if (kind === "prompt") {
    if (!rest) throw new Error(`Invalid --variant "${raw}": missing prompt handle`);
    const [handle, versionRaw] = rest.split("@");
    if (!handle) {
      throw new Error(`Invalid --variant "${raw}": missing prompt handle`);
    }
    if (versionRaw === undefined) return { kind: "prompt", handle };
    const version = Number(versionRaw);
    if (!Number.isFinite(version)) {
      throw new Error(`Invalid --variant "${raw}": version must be a number`);
    }
    return { kind: "prompt", handle, version };
  }
  if (kind === "agent") {
    if (!rest) throw new Error(`Invalid --variant "${raw}": missing agent id`);
    return { kind: "agent", agentId: rest };
  }

  throw new Error(
    `Invalid --variant "${raw}". Expected target:<id>, prompt:<handle>, or agent:<id>.`,
  );
};

export interface AddComparisonOptions {
  variant?: string[];
  goldenField?: string;
  inputField?: string;
  metrics?: string;
  randomize?: boolean;
  format?: string;
}

export const addComparisonCommand = async (
  slug: string,
  options: AddComparisonOptions,
): Promise<void> => {
  checkApiKey();

  const rawVariants = options.variant ?? [];
  if (rawVariants.length < 2) {
    console.error(
      chalk.red(
        "Error: at least two --variant flags are required to build a comparison.",
      ),
    );
    process.exit(1);
  }

  let variants: ComparisonVariantSpec[];
  try {
    variants = rawVariants.map(parseVariantSpec);
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }

  const includeMetrics = options.metrics
    ? options.metrics
        .split(",")
        .map((m) => m.trim())
        .filter((m): m is "cost" | "duration" => m === "cost" || m === "duration")
    : undefined;

  // An empty string (e.g. `--golden-field ""`) is not a real column
  // reference — treat it the same as omitting the flag entirely.
  const goldenField = options.goldenField || undefined;
  const inputField = options.inputField || undefined;

  const service = new ExperimentsApiService();
  const spinner = ora(`Attaching comparison to "${slug}"...`).start();

  try {
    const result = await service.attachComparison({
      slug,
      body: {
        variants,
        goldenField,
        inputField,
        includeMetrics,
        randomizeOrder: options.randomize,
      },
    });

    spinner.succeed(
      `Comparison attached! Target: ${chalk.cyan(result.comparisonTargetId)}`,
    );

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.createdTargetIds.length > 0) {
      console.log(
        `  ${chalk.gray("Created targets:")} ${result.createdTargetIds.join(", ")}`,
      );
    }
    if (result.reusedTargetIds.length > 0) {
      console.log(
        `  ${chalk.gray("Reused targets:")}  ${result.reusedTargetIds.join(", ")}`,
      );
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "attach comparison" });
    process.exit(1);
  }
};

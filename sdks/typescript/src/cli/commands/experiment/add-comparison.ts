import chalk from "chalk";
import {
  ExperimentsApiService,
  type AttachComparisonResponse,
  type ComparisonVariantSpec,
} from "@/client-sdk/services/experiments/experiments-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/** A prompt version suffix is a whole number, and only a whole number. */
const PROMPT_VERSION_RE = /^\d+$/;

const invalidVariant = (raw: string, detail: string): Error =>
  new Error(`Invalid --variant "${raw}": ${detail}`);

const EXPECTED_VARIANT_FORMS =
  "Expected target:<id>, prompt:<handle>[@version], or agent:<id>.";

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
    throw new Error(`Invalid --variant "${raw}". ${EXPECTED_VARIANT_FORMS}`);
  }
  const kind = raw.slice(0, separatorIndex);
  const rest = raw.slice(separatorIndex + 1);

  if (kind === "target") {
    if (!rest) throw invalidVariant(raw, "missing target id");
    return { kind: "existingTarget", targetId: rest };
  }
  if (kind === "prompt") {
    if (!rest) throw invalidVariant(raw, "missing prompt handle");
    return parsePromptVariant(raw, rest);
  }
  if (kind === "agent") {
    if (!rest) throw invalidVariant(raw, "missing agent id");
    return { kind: "agent", agentId: rest };
  }

  throw new Error(`Invalid --variant "${raw}". ${EXPECTED_VARIANT_FORMS}`);
};

/**
 * Splits `<handle>[@<version>]` and insists an `@` that is present names a
 * real version. A permissive parse is worse than a refusal here: `Number("")`
 * is `0`, so `prompt:draft@` would otherwise pin version 0 and quietly compare
 * a version the caller never asked for.
 */
const parsePromptVariant = (
  raw: string,
  rest: string,
): ComparisonVariantSpec => {
  const separatorIndex = rest.lastIndexOf("@");
  if (separatorIndex === -1) return { kind: "prompt", handle: rest };

  const handle = rest.slice(0, separatorIndex);
  const versionRaw = rest.slice(separatorIndex + 1);
  if (!handle) throw invalidVariant(raw, "missing prompt handle");
  if (!PROMPT_VERSION_RE.test(versionRaw)) {
    throw invalidVariant(
      raw,
      `version must be a whole number, got "${versionRaw}". Drop the "@" to use the latest version.`,
    );
  }
  return { kind: "prompt", handle, version: Number(versionRaw) };
};

export interface AddComparisonOptions {
  variant?: string[];
  goldenField?: string;
  inputField?: string;
  metrics?: string;
  randomize?: boolean;
  format?: string;
}

/**
 * A flag given as an empty string (`--golden-field ""`) names no column, so it
 * means the same as not passing the flag at all. Surrounding space is dropped
 * from what survives: a column name is what the caller typed, not what their
 * shell left around it, and sending the padded version gets it rejected as a
 * column that does not exist.
 */
const omitBlank = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const SUPPORTED_METRICS = ["cost", "duration"] as const;
type SupportedMetric = (typeof SUPPORTED_METRICS)[number];

/**
 * Parses `--metrics cost,duration`, refusing anything else by name.
 *
 * Dropping an unrecognised metric silently would answer `--metrics latency`
 * with a comparison carrying no metrics at all and no indication why, which is
 * the same permissive-parse failure the version suffix above refuses.
 */
const parseIncludeMetrics = (
  metrics: string | undefined,
): SupportedMetric[] | undefined => {
  if (!metrics) return undefined;
  return metrics
    .split(",")
    .map((metric) => metric.trim())
    .filter((metric) => metric !== "")
    .map((metric) => {
      if (!(SUPPORTED_METRICS as readonly string[]).includes(metric)) {
        throw new Error(
          `Invalid --metrics value "${metric}". Expected ${SUPPORTED_METRICS.join(" or ")}.`,
        );
      }
      return metric as SupportedMetric;
    });
};

const renderAttachedComparison = (result: AttachComparisonResponse): void => {
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
};

export const addComparisonCommand = async (
  slug: string,
  options: AddComparisonOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const rawVariants = options.variant ?? [];
  if (rawVariants.length < 2) {
    console.error(
      chalk.red(
        "Error: at least two --variant flags are required to build a comparison.",
      ),
    );
    process.exit(1);
  }

  // Everything the flags say is parsed before the request goes out, so a
  // malformed flag reports itself as bad input rather than as a failed attach.
  let variants: ComparisonVariantSpec[];
  let includeMetrics: SupportedMetric[] | undefined;
  try {
    variants = rawVariants.map(parseVariantSpec);
    includeMetrics = parseIncludeMetrics(options.metrics);
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }

  const service = new ExperimentsApiService();
  const spinner = createSpinner(`Attaching comparison to "${slug}"...`).start();

  try {
    const result = await service.attachComparison({
      slug,
      body: {
        variants,
        goldenField: omitBlank(options.goldenField),
        inputField: omitBlank(options.inputField),
        includeMetrics,
        randomizeOrder: options.randomize,
      },
    });

    spinner.succeed(
      `Comparison attached! Target: ${chalk.cyan(result.comparisonTargetId)}`,
    );

    return { data: result, table: () => renderAttachedComparison(result) };
  } catch (error) {
    failSpinner({
      spinner,
      error,
      action: "attach comparison",
      format: options.format,
    });
    process.exit(1);
  }
};

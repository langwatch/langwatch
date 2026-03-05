/**
 * Configuration loading and validation for the parity check tool.
 */

import type { Config } from "./types.js";

/**
 * Parse a numeric environment variable with validation and bounds checking.
 */
export function parseNumericEnv(
  value: string | undefined,
  defaultValue: number,
  options?: { min?: number; max?: number; name?: string },
): number {
  if (!value) return defaultValue;

  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) {
    console.warn(
      `Warning: Invalid ${options?.name ?? "env"}: "${value}", using default: ${defaultValue}`,
    );
    return defaultValue;
  }

  if (options?.min !== undefined && parsed < options.min) {
    console.warn(
      `Warning: ${options?.name ?? "env"} below minimum (${parsed} < ${options.min}), using default: ${defaultValue}`,
    );
    return defaultValue;
  }

  if (options?.max !== undefined && parsed > options.max) {
    console.warn(
      `Warning: ${options?.name ?? "env"} above maximum (${parsed} > ${options.max}), using default: ${defaultValue}`,
    );
    return defaultValue;
  }

  return parsed;
}

export function loadConfig(): Config {
  const config: Config = {
    baseUrl: process.env["BASE_URL"] ?? "http://localhost:3000",
    chApiKey: process.env["CH_API_KEY"] ?? "",
    chProjectId: process.env["CH_PROJECT_ID"] ?? "",
    esApiKey: process.env["ES_API_KEY"] ?? "",
    esProjectId: process.env["ES_PROJECT_ID"] ?? "",
    prodApiKey: process.env["PROD_API_KEY"] ?? null,
    tolerance: parseNumericEnv(process.env["TOLERANCE"], 0.05, {
      min: 0,
      max: 1,
      name: "TOLERANCE",
    }),
    traceCount: Math.floor(
      parseNumericEnv(process.env["TRACE_COUNT"], 5, {
        min: 1,
        name: "TRACE_COUNT",
      }),
    ),
    waitTimeMs: Math.floor(
      parseNumericEnv(process.env["WAIT_TIME_MS"], 120000, {
        min: 1000,
        name: "WAIT_TIME_MS",
      }),
    ),
    runPythonExamples: (process.env["RUN_PYTHON_EXAMPLES"] ?? "true").toLowerCase() === "true",
    runSnippets: (process.env["RUN_SNIPPETS"] ?? "true").toLowerCase() === "true",
    pythonSdkDir: process.env["PYTHON_SDK_DIR"] ?? "../../python-sdk",
  };

  const missing: string[] = [];
  if (!config.esProjectId) missing.push("ES_PROJECT_ID");
  if (!config.esApiKey) missing.push("ES_API_KEY");
  if (!config.chProjectId) missing.push("CH_PROJECT_ID");
  if (!config.chApiKey) missing.push("CH_API_KEY");

  if (missing.length > 0) {
    console.error("Error: Missing required environment variables:");
    missing.forEach((m) => console.error(`  - ${m}`));
    console.error("\nCopy .env.example to .env and fill in the values.");
    process.exit(1);
  }

  return config;
}

export function isVerboseMode(): boolean {
  return (
    process.argv.includes("--verbose") ||
    process.argv.includes("-v") ||
    process.argv.includes("--debug")
  );
}

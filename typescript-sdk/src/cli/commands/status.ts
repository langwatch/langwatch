import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../utils/apiKey";
import {
  createLangWatchApiClient,
} from "@/internal/api/client";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const statusCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const apiClient = createLangWatchApiClient();
  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";
  const spinner = ora("Fetching project status...").start();

  const results: Record<string, { count: number; error?: string; status?: number }> = {};

  async function fetchCount(url: string): Promise<{ data: unknown; error?: unknown; status?: number }> {
    const response = await fetch(`${endpoint}${url}`, {
      headers: { "X-Auth-Token": apiKey },
    });
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      return { data: null, error: body ?? response.statusText, status: response.status };
    }
    const data = await response.json();
    return { data, error: undefined };
  }

  // Fetch counts for all major resources in parallel
  const fetchers = [
    { key: "evaluators", fn: () => apiClient.GET("/api/evaluators") },
    { key: "scenarios", fn: () => apiClient.GET("/api/scenarios") },
    { key: "suites", fn: () => fetchCount("/api/suites") },
    { key: "datasets", fn: () => apiClient.GET("/api/dataset") },
    { key: "agents", fn: () => apiClient.GET("/api/agents") },
    { key: "workflows", fn: () => apiClient.GET("/api/workflows") },
    { key: "dashboards", fn: () => apiClient.GET("/api/dashboards") },
    { key: "triggers", fn: () => fetchCount("/api/triggers") },
    { key: "monitors", fn: () => fetchCount("/api/monitors") },
    { key: "secrets", fn: () => fetchCount("/api/secrets") },
  ];

  await Promise.allSettled(
    fetchers.map(async ({ key, fn }) => {
      try {
        const result = await fn();
        const { data, error } = result;
        const status = (result as { status?: number; response?: { status?: number } }).status
          ?? (result as { response?: { status?: number } }).response?.status;
        if (error) {
          results[key] = {
            count: 0,
            error: formatApiErrorMessage({ error, options: { status } }),
            status,
          };
          return;
        }
        if (Array.isArray(data)) {
          results[key] = { count: data.length };
        } else if (data && typeof data === "object" && "data" in (data as Record<string, unknown>)) {
          const arr = (data as { data: unknown[] }).data;
          results[key] = { count: Array.isArray(arr) ? arr.length : 0 };
        } else if (data && typeof data === "object" && "pagination" in (data as Record<string, unknown>)) {
          const pagination = (data as { pagination: { total: number } }).pagination;
          results[key] = { count: pagination.total };
        } else {
          results[key] = { count: 0 };
        }
      } catch (err) {
        results[key] = { count: 0, error: formatApiErrorMessage({ error: err }) };
      }
    }),
  );

  const errorCount = Object.values(results).filter((r) => r.error).length;
  const totalCount = Object.values(results).length;

  if (errorCount === totalCount && totalCount > 0) {
    spinner.fail("Project status — all resource fetches failed");
  } else {
    spinner.succeed("Project status");
  }

  if (options?.format === "json") {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // If every resource failed — likely auth/endpoint/server issue. Show a
  // clear diagnostic so the user knows what to check instead of puzzling
  // over a grid of red error messages.
  if (errorCount === totalCount && totalCount > 0) {
    const sampleError = Object.values(results).find((r) => r.error)?.error ?? "";
    const statuses = Object.values(results)
      .map((r) => r.status)
      .filter((s): s is number => typeof s === "number");
    const allUnauthorized = statuses.length > 0 && statuses.every((s) => s === 401 || s === 403);
    console.log();
    console.log(chalk.red("  ✗ Could not fetch any project resources."));
    console.log(chalk.gray(`    Reason: ${sampleError}`));
    console.log();
    if (allUnauthorized) {
      console.log(chalk.gray(`    Your API key appears to be invalid or revoked. Re-run ${chalk.cyan("langwatch login")} or check ${chalk.cyan("LANGWATCH_API_KEY")}.`));
    } else {
      console.log(chalk.gray(`    Check ${chalk.cyan("LANGWATCH_API_KEY")} (current endpoint: ${chalk.cyan(endpoint)}).`));
    }
    console.log();
    process.exit(1);
  }

  console.log();
  console.log(chalk.bold("  Resource Counts:"));

  const order = ["evaluators", "scenarios", "suites", "datasets", "agents", "workflows", "dashboards", "triggers", "monitors", "secrets"];
  for (const key of order) {
    const r = results[key];
    if (!r) continue;
    const countStr = r.error
      ? chalk.red(r.error)
      : chalk.cyan(String(r.count));
    console.log(`    ${chalk.gray(key + ":")} ${" ".repeat(14 - key.length)}${countStr}`);
  }

  console.log();
  console.log(chalk.gray("  Available CLI commands:"));
  console.log(chalk.gray("    langwatch evaluator list    langwatch scenario list"));
  console.log(chalk.gray("    langwatch dataset list      langwatch agent list"));
  console.log(chalk.gray("    langwatch workflow list      langwatch dashboard list"));
  console.log(chalk.gray("    langwatch suite list        langwatch trigger list"));
  console.log(chalk.gray("    langwatch monitor list      langwatch secret list"));
  console.log(chalk.gray("    langwatch graph list        langwatch simulation-run list"));
  console.log(chalk.gray("    langwatch trace search      langwatch analytics query"));
  console.log(chalk.gray("    langwatch annotation list   langwatch model-provider list"));
  console.log();
  console.log(chalk.gray("  Execution:"));
  console.log(chalk.gray("    langwatch evaluation run <slug> [--wait]"));
  console.log(chalk.gray("    langwatch suite run <id> [--wait]"));
  console.log(chalk.gray("    langwatch scenario run <id> --target <type>:<ref>"));
  console.log(chalk.gray("    langwatch agent run <id> --input <json>"));
  console.log(chalk.gray("    langwatch workflow run <id> --input <json>"));
  console.log();
};

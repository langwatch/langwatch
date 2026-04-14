import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../utils/apiKey";
import {
  createLangWatchApiClient,
} from "@/internal/api/client";

export const statusCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const apiClient = createLangWatchApiClient();
  const spinner = ora("Fetching project status...").start();

  const results: Record<string, { count: number; error?: string }> = {};

  // Fetch counts for all major resources in parallel
  const fetchers = [
    { key: "evaluators", fn: () => apiClient.GET("/api/evaluators") },
    { key: "scenarios", fn: () => apiClient.GET("/api/scenarios") },
    { key: "datasets", fn: () => apiClient.GET("/api/dataset") },
    { key: "workflows", fn: () => apiClient.GET("/api/workflows") },
    { key: "agents", fn: () => apiClient.GET("/api/agents") },
    { key: "dashboards", fn: () => apiClient.GET("/api/dashboards") },
    { key: "suites", fn: async () => {
      const apiKey = process.env.LANGWATCH_API_KEY ?? "";
      const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";
      const response = await fetch(`${endpoint}/api/suites`, {
        headers: { "X-Auth-Token": apiKey },
      });
      if (!response.ok) return { data: null, error: "fetch failed" };
      const data = await response.json();
      return { data, error: undefined };
    }},
  ];

  await Promise.allSettled(
    fetchers.map(async ({ key, fn }) => {
      try {
        const { data, error } = await fn();
        if (error) {
          results[key] = { count: 0, error: "fetch failed" };
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
      } catch {
        results[key] = { count: 0, error: "unavailable" };
      }
    }),
  );

  spinner.succeed("Project status");

  if (options?.format === "json") {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log();
  console.log(chalk.bold("  Resource Counts:"));

  const order = ["evaluators", "scenarios", "suites", "datasets", "agents", "workflows", "dashboards"];
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
  console.log(chalk.gray("    langwatch suite list        langwatch simulation-run list"));
  console.log(chalk.gray("    langwatch trace search      langwatch analytics query"));
  console.log(chalk.gray("    langwatch annotation list   langwatch model-provider list"));
  console.log(chalk.gray("    langwatch evaluation run <slug>"));
  console.log(chalk.gray("    langwatch suite run <id>    langwatch scenario run <id> --target ..."));
  console.log();
};

import chalk from "chalk";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { SimulationRunEvaluation } from "@/client-sdk/services/simulation-runs";
import { buildAuthHeaders } from "@/internal/api/auth";
import { scopedApiKey } from "@/internal/credentialContext";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

import { resolveCredentials } from "../../utils/apiKey.ts";
import { readFetchFailure } from "../../utils/formatFetchError.ts";
import type { CommandResult } from "../../utils/output.ts";
import { createSpinner } from "../../utils/spinner.ts";
import { failSpinner } from "../../utils/spinnerError.ts";
/**
 * Flattens Anthropic-style content (string OR array of {type:text|tool_use|tool_result|thinking})
 * into a readable single-line string. Thinking blocks are dropped; tool_use shows the tool name;
 * tool_result inlines the result text. Falls back to JSON.stringify for unknown shapes.
 */
function renderContent(raw: unknown): string {
  if (typeof raw === "string") {
    return renderStringContent(raw);
  }
  if (Array.isArray(raw)) {
    return raw.map(renderContent).filter(Boolean).join("\n");
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return renderContentBlock(obj);
  }
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return "";
}

const EVALUATION_STATUS_COLOR: Record<SimulationRunEvaluation["status"], (text: string) => string> =
  {
    passed: chalk.green,
    failed: chalk.red,
    scored: chalk.cyan,
    skipped: chalk.gray,
    error: chalk.red,
  };

/**
 * One line per evaluator that ran: status, score if produced, whether it
 * gates the scenario, and the reason. A skipped one names the blank field;
 * a failed required one is what failed the scenario.
 */
function printEvaluations(evaluations: SimulationRunEvaluation[] | undefined): void {
  if (!evaluations || evaluations.length === 0) return;
  console.log();
  console.log(chalk.bold("  Evaluators:"));
  for (const evaluation of evaluations) {
    const color = EVALUATION_STATUS_COLOR[evaluation.status] ?? chalk.white;
    const parts = [color(evaluation.status)];
    if (evaluation.score !== undefined) parts.push(`score ${evaluation.score}`);
    if (evaluation.label !== undefined) parts.push(evaluation.label);
    if (evaluation.required) parts.push(chalk.gray("required"));
    console.log(
      `    ${chalk.gray("•")} ${evaluation.name} ${chalk.gray("·")} ${parts.join(chalk.gray(" · "))}`,
    );
    if (evaluation.details) {
      console.log(`        ${chalk.gray(evaluation.details)}`);
    }
  }
}

export const getSimulationRunCommand = async (
  runId: string,
  options?: { full?: boolean },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Fetching simulation run "${runId}"...`).start();

  try {
    const response = await langwatchFetch(
      `${endpoint}/api/v1/simulation-runs/${encodeURIComponent(runId)}`,
      {
        method: "GET",
        headers: buildAuthHeaders({ apiKey }),
      },
    );

    if (!response.ok) {
      failSpinner({
        spinner,
        error: await readFetchFailure(response),
        action: "fetch simulation run",
      });
      process.exit(1);
    }

    const run = (await response.json()) as {
      scenarioRunId: string;
      scenarioId: string;
      batchRunId: string;
      name: string | null;
      description: string | null;
      status: string;
      results: {
        verdict?: string | null;
        reasoning?: string | null;
        metCriteria?: string[];
        unmetCriteria?: string[];
        error?: string | null;
        evaluations?: SimulationRunEvaluation[];
      } | null;
      messages: { role: string; content: string }[];
      timestamp: number;
      updatedAt: number;
      durationInMs: number;
      totalCost?: number;
      note?: string | null;
      scenarioVersion?: number | null;
    };

    spinner.succeed(`Found simulation run "${run.name ?? run.scenarioRunId}"`);

    return {
      data: run,
      table: () => {
        const statusColor = simulationStatusColor(run.status);

        console.log();
        console.log(chalk.bold("  Simulation Run Details:"));
        console.log(`    ${chalk.gray("Run ID:")}      ${chalk.green(run.scenarioRunId)}`);
        console.log(`    ${chalk.gray("Scenario ID:")} ${run.scenarioId}`);
        console.log(`    ${chalk.gray("Batch ID:")}    ${run.batchRunId}`);
        console.log(`    ${chalk.gray("Name:")}        ${run.name ?? chalk.gray("—")}`);
        console.log(`    ${chalk.gray("Status:")}      ${statusColor(run.status)}`);
        console.log(
          `    ${chalk.gray("Duration:")}    ${run.durationInMs > 0 ? `${(run.durationInMs / 1000).toFixed(1)}s` : "—"}`,
        );
        if (run.totalCost) {
          console.log(`    ${chalk.gray("Cost:")}        $${run.totalCost.toFixed(4)}`);
        }
        console.log(
          `    ${chalk.gray("Started:")}     ${new Date(run.timestamp).toLocaleString()}`,
        );
        // Both lines are left out when the run carries nothing: a run stored
        // before versions were recorded has no version to name, and a batch
        // started without a note has no note.
        if (run.scenarioVersion) {
          console.log(`    ${chalk.gray("Version:")}     v${run.scenarioVersion}`);
        }
        if (run.note) {
          console.log(`    ${chalk.gray("Note:")}        ${run.note}`);
        }

        printRunResults(run.results);

        printRunConversation(run.messages, options?.full);

        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch simulation run" });
    process.exit(1);
  }
};

function simulationStatusColor(status: string) {
  if (status === "SUCCESS") return chalk.green;
  if (status === "FAILED" || status === "ERROR") return chalk.red;
  return chalk.yellow;
}

function messageRoleColor(role: string) {
  if (role === "user") return chalk.blue;
  if (role === "assistant") return chalk.green;
  return chalk.gray;
}

function renderStringContent(raw: string): string {
  // Try one round of JSON parse so single Anthropic blocks (`{"type":"thinking",...}`)
  // and array-stringified content render as readable text instead of raw JSON.
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      return renderContent(JSON.parse(trimmed));
    } catch {
      return raw;
    }
  }
  if (trimmed.startsWith("[")) {
    try {
      return renderContent(JSON.parse(trimmed));
    } catch {
      return raw;
    }
  }
  return raw;
}

function renderContentBlock(obj: Record<string, unknown>): string {
  switch (obj.type) {
    case "thinking":
      return ""; // drop reasoning blobs
    case "text":
      return typeof obj.text === "string" ? obj.text : "";
    case "tool_use": {
      const name = typeof obj.name === "string" ? obj.name : "?";
      return chalk.yellow(`[tool ${name}]`);
    }
    case "tool_result": {
      const inner = renderContent(obj.content);
      return inner ? chalk.gray(`[result] `) + inner : "";
    }
    default:
      try {
        return JSON.stringify(obj);
      } catch {
        return "";
      }
  }
}

interface SimulationRunResults {
  verdict?: string | null;
  reasoning?: string | null;
  metCriteria?: string[];
  unmetCriteria?: string[];
  error?: string | null;
  evaluations?: SimulationRunEvaluation[];
}

function printRunResults(results: SimulationRunResults | null): void {
  if (!results) return;
  console.log();
  console.log(chalk.bold("  Results:"));
  if (results.verdict) {
    const verdictColor = results.verdict === "passed" ? chalk.green : chalk.red;
    console.log(`    ${chalk.gray("Verdict:")}    ${verdictColor(results.verdict)}`);
  }
  if (results.reasoning) {
    console.log(`    ${chalk.gray("Reasoning:")}  ${results.reasoning}`);
  }
  const metCriteria = results.metCriteria;
  if (metCriteria && metCriteria.length > 0) {
    console.log(`    ${chalk.gray("Met:")}        ${chalk.green(metCriteria.join(", "))}`);
  }
  const unmetCriteria = results.unmetCriteria;
  if (unmetCriteria && unmetCriteria.length > 0) {
    console.log(`    ${chalk.gray("Unmet:")}      ${chalk.red(unmetCriteria.join(", "))}`);
  }
  if (results.error) {
    console.log(`    ${chalk.gray("Error:")}      ${chalk.red(results.error)}`);
  }
  printEvaluations(results.evaluations);
}

function printRunConversation(
  messages: { role: string; content: string }[],
  full: boolean | undefined,
): void {
  if (!messages || messages.length === 0) return;
  console.log();
  console.log(chalk.bold("  Conversation:"));
  const truncate = !full;
  for (const msg of messages) {
    const roleColor = messageRoleColor(msg.role);
    let content = renderContent(msg.content);
    if (!content) continue;
    if (truncate && content.length > 400) {
      content = content.slice(0, 400) + chalk.gray("… (--full to see all)");
    }
    console.log(`    ${roleColor(`[${msg.role}]`)} ${content}`);
  }
}

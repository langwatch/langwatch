import { expect } from "vitest";
import * as scenario from "@langwatch/scenario";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.resolve(__dirname, "scenario-logs");

type RunConfig = Parameters<typeof scenario.run>[0];
type Result = Awaited<ReturnType<typeof scenario.run>>;

/**
 * Drop-in wrapper around `scenario.run` that, after the run completes,
 * writes the full conversation transcript + judge reasoning + verdict
 * to `scenario-logs/<vitest-test-name-slug>.md`. The slug comes from
 * `expect.getState().currentTestName` so each it() lands in its own
 * file regardless of how the run is named internally.
 *
 * If the log write itself fails we swallow the error — the scenario
 * verdict is what the suite asserts on, and a disk write should never
 * mask a real pass/fail.
 */
export async function runScenarioAndLog(config: RunConfig): Promise<Result> {
  const result = await scenario.run(config);
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const testName =
      expect.getState().currentTestName ??
      (config as { name?: string }).name ??
      "unknown";
    const slug = slugify(testName);
    const filePath = path.join(LOG_DIR, `${slug}.md`);
    await fs.writeFile(filePath, formatAsMarkdown(testName, result), "utf8");
  } catch {
    // intentionally silent — see jsdoc above.
  }
  return result;
}

function slugify(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 140) || "unnamed"
  );
}

function formatAsMarkdown(testName: string, result: Result): string {
  const out: string[] = [];
  out.push(`# ${testName}`);
  out.push("");
  out.push(`**Verdict:** ${result.success ? "PASS" : "FAIL"}`);
  out.push(`**Generated:** ${new Date().toISOString()}`);
  if ((result as { reasoning?: string }).reasoning) {
    out.push("");
    out.push("## Judge reasoning");
    out.push("");
    out.push((result as { reasoning?: string }).reasoning ?? "");
  }
  const met = (result as { metCriteria?: string[] }).metCriteria;
  const unmet = (result as { unmetCriteria?: string[] }).unmetCriteria;
  if (met?.length || unmet?.length) {
    out.push("");
    out.push("## Criteria");
    for (const c of met ?? []) out.push(`- [x] ${c}`);
    for (const c of unmet ?? []) out.push(`- [ ] ${c}`);
  }
  out.push("");
  out.push("## Conversation");
  out.push("");
  const messages =
    (result as { messages?: Array<Record<string, unknown>> }).messages ?? [];
  for (const msg of messages) {
    const role = String(msg.role ?? "?");
    out.push(`### ${role}`);
    out.push("");
    renderMessageContent(out, msg.content);
    out.push("");
  }
  return out.join("\n");
}

function renderMessageContent(out: string[], content: unknown): void {
  if (typeof content === "string") {
    out.push(content);
    return;
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === "string") {
        out.push(part);
        continue;
      }
      if (part && typeof part === "object") {
        const obj = part as Record<string, unknown>;
        if (typeof obj.text === "string") {
          out.push(obj.text);
          continue;
        }
        if (obj.type === "tool-call" || obj.type === "tool-result") {
          out.push("```json");
          out.push(JSON.stringify(obj, null, 2));
          out.push("```");
          continue;
        }
      }
      out.push("```json");
      out.push(JSON.stringify(part, null, 2));
      out.push("```");
    }
    return;
  }
  out.push("```json");
  out.push(JSON.stringify(content, null, 2));
  out.push("```");
}

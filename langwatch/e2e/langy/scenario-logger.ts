import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as scenario from "@langwatch/scenario";
import { expect } from "vitest";
import { browserQA, type BrowserQACheck, type BrowserQAResult } from "./browser-qa";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.resolve(__dirname, "scenario-logs");

type RunConfig = Parameters<typeof scenario.run>[0];
type Result = Awaited<ReturnType<typeof scenario.run>>;

/** Browser-QA override for one scenario. `label` defaults to the test name. */
export type BrowserQAOptions = Partial<BrowserQACheck>;

/**
 * Drop-in wrapper around `scenario.run` that, after the run completes:
 *  1. Runs a browser-QA pass (see browser-qa.ts) — a third, independent check
 *     against the real product surface, on top of the judge's verdict on the
 *     conversation. Every scenario gets one, even with no `browserQA` arg:
 *     that default is a pure evidence screenshot of the project home.
 *  2. Writes the full conversation transcript + judge reasoning + verdict +
 *     browser-QA result to `scenario-logs/<vitest-test-name-slug>.md`. The
 *     slug comes from `expect.getState().currentTestName` so each it() lands
 *     in its own file regardless of how the run is named internally.
 *
 * Neither the browser-QA pass nor the log write can crash the scenario
 * result itself — the judge verdict is what the suite asserts on, and a
 * verification aid or a disk write should never mask a real pass/fail.
 *
 * `config` stays a single positional argument (not `{ config, ... }`) by
 * design — this wraps `scenario.run(config)`, an external library call that
 * itself takes one positional config object, and every one of this
 * function's 50+ existing call sites already passes `config` as an inline
 * object literal. `browserQAOptions` is the one true second argument, and it
 * was already an options object, not a bag of positional values.
 */
export async function runScenarioAndLog(
  config: RunConfig,
  browserQAOptions?: BrowserQAOptions,
): Promise<Result> {
  const result = await scenario.run(config);
  const testName =
    expect.getState().currentTestName ??
    (config as { name?: string }).name ??
    "unknown";

  let qa: BrowserQAResult | null = null;
  try {
    qa = await browserQA({
      label: browserQAOptions?.label ?? testName,
      path: browserQAOptions?.path,
      verify: browserQAOptions?.verify,
    });
  } catch {
    // intentionally silent — see jsdoc above.
  }

  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const slug = slugify(testName);
    const filePath = path.join(LOG_DIR, `${slug}.md`);
    await fs.writeFile(
      filePath,
      formatAsMarkdown(testName, result, qa),
      "utf8",
    );
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

function formatAsMarkdown(
  testName: string,
  result: Result,
  qa: BrowserQAResult | null,
): string {
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
  out.push("## Browser QA");
  out.push("");
  if (qa) {
    out.push(`**Verdict:** ${qa.passed ? "PASS" : "FAIL"}`);
    out.push(`**Notes:** ${qa.notes}`);
    out.push(`**Screenshot:** ${qa.screenshotPath}`);
  } else {
    out.push("Browser QA did not run (see stderr for the error).");
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

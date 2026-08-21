import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as scenario from "@langwatch/scenario";
import { expect } from "vitest";
import {
  type BrowserQACheck,
  type BrowserQAResult,
  browserQA,
} from "./browser-qa";
import { isTransientInfrastructureError } from "./langy-agent";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.resolve(__dirname, "scenario-logs");

type RunConfig = Parameters<typeof scenario.run>[0];
type Result = Awaited<ReturnType<typeof scenario.run>>;

/** Browser-QA override for one scenario. `label` defaults to the test name. */
export type BrowserQAOptions = Partial<BrowserQACheck>;

/**
 * Second-argument options bag. `browserQA` overrides the QA pass; `beforeRetry`
 * makes a scenario whose write CANNOT simply be repeated safe under the
 * whole-scenario replay (see `runScenarioAndLog`).
 */
export type RunOptions = BrowserQAOptions & {
  /**
   * Runs after a transient infrastructure failure and before the replay,
   * so a scenario can rebuild the world state its script consumes.
   *
   * The motivating case is deletion: the first attempt can delete its target
   * and THEN hit a dead worker, leaving the replay asking Langy to delete
   * something that no longer exists — a judge failure for work that actually
   * succeeded. Such a scenario re-seeds here and returns the new target.
   */
  beforeRetry?: () => Promise<void>;
};

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
  browserQAOptions?: RunOptions,
): Promise<Result> {
  // Two transients get one retry, both infrastructure rather than agent
  // behaviour: langy_worker_stopped (the worker died mid-reply, server-side
  // recovery already exhausted — the panel offers the user a retry too), and a
  // turn that never settled because the conversation lock was still held or the
  // machine was too loaded to answer inside the adapter's retry budget.
  // Judge verdicts never come through here — a scenario that FAILS its criteria
  // returns normally and is not retried.
  //
  // The retry replays the WHOLE scenario, and the worker can die after Langy
  // finished a create. So every scenario reaching this helper has to tolerate
  // its writes happening twice: the platform accepts a repeated name and gives
  // it a fresh id, and each Layer 2 check reads back the resource it asked for
  // rather than counting how many appeared. A scenario whose write cannot be
  // repeated must not run through here WITHOUT a `beforeRetry` that rebuilds
  // the state the script consumes — that hook is what makes a deletion
  // scenario replay-safe, by re-seeding the victim the first attempt removed.
  // The adapter marks both on the error it throws, so this reads a flag rather
  // than looking for a code inside prose that is free to be reworded.
  let result: Result;
  try {
    result = await scenario.run(config);
  } catch (error) {
    if (!isTransientInfrastructureError(error)) throw error;
    console.log(`[scenario] transient infrastructure failure, retrying once`);
    await browserQAOptions?.beforeRetry?.();
    result = await scenario.run(config);
  }
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
      formatAsMarkdown({ testName, result, qa }),
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

function formatAsMarkdown({
  testName,
  result,
  qa,
}: {
  testName: string;
  result: Result;
  qa: BrowserQAResult | null;
}): string {
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

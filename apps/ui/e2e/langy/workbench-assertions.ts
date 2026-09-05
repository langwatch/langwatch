/**
 * The Layer-2 facts the prompt-improvement suite asserts, in one place.
 *
 * Not a test file on purpose: an `expect` inside a helper that lives beside its
 * `it()` reads as a misplaced assertion, and a helper the suites share has no
 * business being in one of them.
 *
 * The fake-tab helpers this module carried alongside these are not here: the
 * fake workbench tab did not travel, and nothing in this lane reads a run's
 * event stream.
 */

import { expect } from "vitest";
import { PROJECT_ID } from "./config";
import { getWorkbenchState, listExperimentRuns } from "./seed-optimization-workbench";
import { getSessionCookie, trpcQuery } from "./trpc";

/** The serialized baseline column, taken before Langy touches anything. */
export async function readBaselineTarget({
  slug,
  baselineTargetId,
}: {
  slug: string;
  baselineTargetId: string;
}): Promise<string> {
  const before = await getWorkbenchState(slug);
  return JSON.stringify(before.state.targets.find((target) => target.id === baselineTargetId));
}

/**
 * The workbench a finished improvement loop leaves behind.
 *
 * The baseline column is byte-identical, at least one candidate prompt column
 * exists carrying a draft, the evaluator is wired onto a candidate rather than
 * only onto the original, and at least one run was recorded.
 */
export async function expectOptimizedWorkbench({
  slug,
  baselineTargetId,
  datasetId,
  baselineBefore,
}: {
  slug: string;
  baselineTargetId: string;
  datasetId: string;
  /** What `readBaselineTarget` answered before the conversation started. */
  baselineBefore: string;
}): Promise<void> {
  const after = await getWorkbenchState(slug);
  const baselineAfter = JSON.stringify(
    after.state.targets.find((target) => target.id === baselineTargetId),
  );
  expect(baselineAfter).toBe(baselineBefore);

  const candidates = after.state.targets.filter(
    (target) => target.id !== baselineTargetId && target.type === "prompt",
  );
  expect(
    candidates.length,
    "no candidate prompt column was created beside the baseline",
  ).toBeGreaterThan(0);
  expect(
    candidates.some((target) => target.localPromptConfig),
    "no candidate column carries a prompt draft",
  ).toBe(true);

  const evaluator = after.state.evaluators[0];
  expect(evaluator, "the workbench holds no evaluator").toBeDefined();
  const evaluatorTargets = Object.keys(evaluator!.mappings[datasetId] ?? {});
  expect(
    candidates.some((target) => evaluatorTargets.includes(target.id)),
    `the evaluator is mapped onto ${JSON.stringify(evaluatorTargets)}, none of which is a candidate column`,
  ).toBe(true);

  expect(
    (await listExperimentRuns(slug)).length,
    "no run was recorded for the experiment",
  ).toBeGreaterThan(0);
}

// ── what the conversation recorded ──────────────────────────────────────────

/** One part of a recorded assistant message. */
interface RecordedPart {
  type?: unknown;
  text?: unknown;
}

/**
 * The recorded turn keeps the order the turn happened in.
 *
 * A turn is a sequence: a paragraph, a call, another paragraph, another call.
 * A record that holds every call first and one closing paragraph gives a
 * reader who refreshes a pile of cards and no account of the work.
 * Read the way the panel reads it on reload, and asserted as the interleaving
 * rather than as a count, because how many calls a turn makes is the model's
 * business and how they are ordered is not.
 */
export async function expectInterleavedTranscript(conversationId: string | null): Promise<void> {
  expect(conversationId, "the scenario recorded no conversation").toBeTruthy();
  const { messages } = await trpcQuery<{
    messages: { role: string; parts: RecordedPart[] }[];
  }>({
    cookie: await getSessionCookie(),
    path: "langy.messages",
    input: { projectId: PROJECT_ID, conversationId },
  });

  const working = messages
    .filter((message) => message.role === "assistant")
    .map((message) => {
      const texts: number[] = [];
      const tools: number[] = [];
      message.parts.forEach((part, index) => {
        if (typeof part.type !== "string") return;
        if (part.type === "text") {
          if (typeof part.text === "string" && part.text.trim()) {
            texts.push(index);
          }
          return;
        }
        if (part.type.startsWith("tool-")) tools.push(index);
      });
      return { texts, tools };
    })
    .filter((message) => message.tools.length > 0);

  expect(
    working.length,
    "no recorded assistant message ran a tool, so there is no order to read",
  ).toBeGreaterThan(0);

  const interleaved = working.filter(
    (message) =>
      message.texts.length > 1 && message.texts[0]! < message.tools[message.tools.length - 1]!,
  );
  expect(
    interleaved.length,
    `every recorded turn put its whole reply after its last call: ${JSON.stringify(working)}`,
  ).toBeGreaterThan(0);
}

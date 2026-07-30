import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { FailureSignature, RunFact } from "../report.types";

/**
 * Chooses which conversations the model gets to read.
 *
 * A run can be hundreds of scenarios with fifty-turn conversations, which is
 * far more than fits in one request and far more than is useful. Three rules do
 * the work:
 *
 * 1. Passing conversations are never sent. They contribute counts; nobody needs
 *    prose about them, and they are most of the volume.
 * 2. Failing runs are already grouped into signatures deterministically, so
 *    twenty repeats of one failure are one thing to read, not twenty.
 * 3. Exemplars are taken round-robin across signatures, so every distinct
 *    failure mode is represented before any mode gets a second example.
 *
 * Whatever is left out is counted and rendered, because a report that read a
 * quarter of the evidence and does not say so is claiming more than it checked.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

const MAX_TRANSCRIPTS = 24;
const MAX_TRANSCRIPT_CHARS = 6_000;
/** Turns kept from the end of a conversation, where a failure usually lands. */
const TAIL_TURNS = 12;

export interface SelectedTranscript {
  runId: string;
  signatureId: string;
  scenarioName: string;
  turns: { index: number; role: string; content: string }[];
  omittedTurns: number;
}

export interface TranscriptSelection {
  transcripts: SelectedTranscript[];
  signaturesCovered: number;
}

/**
 * Picks exemplar conversations, breadth first across failure modes.
 *
 * Ties break on run id so the same run selects the same conversations twice —
 * without that, two reports of one unchanged run would differ.
 */
export function selectTranscripts({
  signatures,
  runFacts,
  runsById,
  maxTranscripts = MAX_TRANSCRIPTS,
}: {
  signatures: FailureSignature[];
  runFacts: RunFact[];
  runsById: Map<string, ScenarioRunData>;
  maxTranscripts?: number;
}): TranscriptSelection {
  const factsById = new Map(runFacts.map((fact) => [fact.runId, fact]));
  const selected: SelectedTranscript[] = [];
  const coveredSignatures = new Set<string>();

  for (const candidate of breadthFirstOrder({ signatures })) {
    if (selected.length >= maxTranscripts) break;

    const picked = pickTranscript({ ...candidate, runsById, factsById });
    if (!picked) continue;

    selected.push(picked);
    coveredSignatures.add(candidate.signatureId);
  }

  return { transcripts: selected, signaturesCovered: coveredSignatures.size };
}

/**
 * Every failing run, ordered so that each group's first example comes before
 * any group's second.
 *
 * Truncating this list therefore costs depth, never a whole failure mode —
 * which is the property the budget exists to protect. Runs are sorted within a
 * group so the same run selects the same conversations twice.
 */
function breadthFirstOrder({
  signatures,
}: {
  signatures: FailureSignature[];
}): { runId: string; signatureId: string }[] {
  const queues = signatures.map((signature) => ({
    signatureId: signature.signatureId,
    runIds: [...signature.runIds].sort(),
  }));
  const deepest = Math.max(0, ...queues.map((queue) => queue.runIds.length));
  const order: { runId: string; signatureId: string }[] = [];

  for (let round = 0; round < deepest; round++) {
    for (const queue of queues) {
      const runId = queue.runIds[round];
      if (runId) order.push({ runId, signatureId: queue.signatureId });
    }
  }

  return order;
}

function pickTranscript({
  runId,
  signatureId,
  runsById,
  factsById,
}: {
  runId: string;
  signatureId: string;
  runsById: Map<string, ScenarioRunData>;
  factsById: Map<string, RunFact>;
}): SelectedTranscript | null {
  const run = runsById.get(runId);
  const fact = factsById.get(runId);
  if (!run || !fact) return null;

  return toTranscript({ run, fact, signatureId });
}

/**
 * Keeps the opening turn and the tail.
 *
 * A conversation fails at its end — the opening establishes what was asked and
 * the tail is where it went wrong. The middle is dropped with an explicit
 * marker rather than silently, so the model knows it is not seeing everything
 * and does not describe the gap as if it had read it.
 */
function toTranscript({
  run,
  fact,
  signatureId,
}: {
  run: ScenarioRunData;
  fact: RunFact;
  signatureId: string;
}): SelectedTranscript {
  const messages = run.messages ?? [];
  const kept: { index: number; role: string; content: string }[] = [];
  const tailStart = Math.max(1, messages.length - TAIL_TURNS);

  messages.forEach((message, index) => {
    if (index !== 0 && index < tailStart) return;
    kept.push({
      index,
      role: String((message as { role?: unknown }).role ?? "unknown"),
      content: truncate(
        String((message as { content?: unknown }).content ?? ""),
        MAX_TRANSCRIPT_CHARS / Math.max(1, Math.min(messages.length, 13)),
      ),
    });
  });

  return {
    runId: fact.runId,
    signatureId,
    scenarioName: fact.scenarioName,
    turns: kept,
    omittedTurns: Math.max(0, messages.length - kept.length),
  };
}

function truncate(text: string, limit: number): string {
  const max = Math.max(200, Math.floor(limit));
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated]`;
}

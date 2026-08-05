/**
 * Grouping runs that failed the same way.
 *
 * A run that errored or stalled never reached the judge, so it is grouped by
 * the shape of its error and never mixed with judged failures: putting them
 * together buries the failures that actually say something about the agent.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

import type { CriterionFact, FailureSignature, RunFact } from "../report.types";
import { normalizeErrorShape, signatureIdFor } from "./fingerprint";

/**
 * Groups runs that failed the same way.
 *
 * A run that errored or stalled never reached the judge, so it is grouped by
 * the shape of its error and never mixed with judged failures. Putting them in
 * one list reads as "eleven things wrong with your agent" when four of them are
 * one thing wrong with the test environment.
 */
export function buildSignatures({
  runFacts,
  criteria,
}: {
  runFacts: RunFact[];
  criteria: CriterionFact[];
}): FailureSignature[] {
  const criterionIdByRunAndText = new Map(
    criteria.map((fact) => [
      `${fact.scenarioId}\u0000${fact.text}`,
      fact.criterionId,
    ]),
  );
  const signatures = new Map<string, FailureSignature>();

  for (const run of runFacts) {
    if (!didNotPass(run)) continue;

    const kind = signatureKindFor(run);
    const signature = signatureFor({ run, kind, signatures });
    addRunToSignature({
      signature,
      run,
      criterionIds:
        kind === "judged"
          ? resolveCriterionIds({ run, criterionIdByRunAndText })
          : [],
    });
    signatures.set(signature.signatureId, signature);
  }

  return [...signatures.values()];
}

/** The group this run belongs to, created on first sight of its shape. */
function signatureFor({
  run,
  kind,
  signatures,
}: {
  run: RunFact;
  kind: FailureSignature["kind"];
  signatures: Map<string, FailureSignature>;
}): FailureSignature {
  // Unwrapped first: normalising a serialised Error envelope collapses every
  // JSON-shaped error in the run into one signature, because the
  // quoted-fragment rule reduces the whole envelope to `{"<value>":"<value>"}`.
  const errorShape = run.error
    ? normalizeErrorShape(unwrapErrorMessage(run.error))
    : null;
  const signatureId = signatureIdFor({
    kind,
    unmetCriteria: kind === "judged" ? run.unmetCriteria : [],
    errorShape,
  });

  return (
    signatures.get(signatureId) ?? {
      signatureId,
      kind,
      unmetCriterionIds: [],
      errorShape,
      errorExample: run.error ? toReadableError(run.error) : null,
      runIds: [],
      scenarioIds: [],
    }
  );
}

/**
 * The part of a recorded error a person needs, cut to a readable length.
 *
 * Runs record a serialised Error — `{"name","message","stack"}` — so the raw
 * value opens with its own envelope and carries a stack trace that is longer
 * than everything else in the group put together. The message is the half that
 * says what went wrong, so it is unwrapped when it is there and the rest is
 * left behind. Anything that is not that shape is used as it stands.
 */
function toReadableError(error: string): string {
  const collapsed = unwrapErrorMessage(error).replace(/\s+/g, " ").trim();
  return collapsed.length <= 300 ? collapsed : `${collapsed.slice(0, 300)}…`;
}

function unwrapErrorMessage(error: string): string {
  if (!error.trimStart().startsWith("{")) return error;
  try {
    const parsed: unknown = JSON.parse(error);
    const message = (parsed as { message?: unknown } | null)?.message;
    return typeof message === "string" && message.trim() !== ""
      ? message
      : error;
  } catch {
    return error;
  }
}

/** A run that reached a terminal state without passing. */
function didNotPass(run: RunFact): boolean {
  return (
    run.category !== "success" &&
    run.category !== "in_progress" &&
    run.category !== "queued"
  );
}

function resolveCriterionIds({
  run,
  criterionIdByRunAndText,
}: {
  run: RunFact;
  criterionIdByRunAndText: Map<string, string>;
}): string[] {
  return run.unmetCriteria
    .map((text) =>
      criterionIdByRunAndText.get(`${run.scenarioId}\u0000${text}`),
    )
    .filter((id): id is string => id !== undefined);
}

/**
 * Folds one run into its group.
 *
 * Every scenario's own criterion id is kept, so a claim can cite the exact
 * criterion in the exact scenario even though the group spans several.
 */
function addRunToSignature({
  signature,
  run,
  criterionIds,
}: {
  signature: FailureSignature;
  run: RunFact;
  criterionIds: string[];
}): void {
  signature.runIds.push(run.runId);
  for (const criterionId of criterionIds) {
    if (!signature.unmetCriterionIds.includes(criterionId)) {
      signature.unmetCriterionIds.push(criterionId);
    }
  }
  if (!signature.scenarioIds.includes(run.scenarioId)) {
    signature.scenarioIds.push(run.scenarioId);
  }
}

function signatureKindFor(run: RunFact): FailureSignature["kind"] {
  if (run.category === "stalled") return "stalled";
  if (run.category === "cancelled") return "cancelled";
  // A failure with no unmet criteria was never judged against anything — it
  // fell over. Calling it a judged failure would invent a verdict.
  return run.unmetCriteria.length > 0 ? "judged" : "errored";
}

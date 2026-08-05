import { createHash } from "node:crypto";
import type { FailureSignature } from "../report.types";

/**
 * Stable identities for the things a report talks about.
 *
 * Criteria are free text on the run record, so "the same criterion" across two
 * runs can only be recognised by normalising the text. That normalisation is
 * deliberately conservative — trim, collapse whitespace, lowercase — because
 * anything cleverer starts merging criteria that a person wrote differently on
 * purpose. Rewording a criterion legitimately produces a new id, and the trend
 * calls that "new" rather than inventing continuity it cannot prove.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

const ID_LENGTH = 12;

function shortHash(parts: string[]): string {
  return createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, ID_LENGTH);
}

/** Trim, collapse internal whitespace, lowercase. Nothing else. */
export function normalizeCriterion(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Identity of a criterion within a scenario.
 *
 * Scoped to the scenario because two scenarios can reasonably share a criterion
 * string ("responds in English") while meaning it about different behaviour;
 * merging them would produce a trend across things that were never the same.
 */
export function criterionIdFor({
  scenarioId,
  text,
}: {
  scenarioId: string;
  text: string;
}): string {
  return `c_${shortHash([scenarioId, normalizeCriterion(text)])}`;
}

/**
 * Reduces an error message to its shape so two instances of the same failure
 * group together.
 *
 * Strips the parts that differ per occurrence — ids, numbers, quoted fragments,
 * URLs, hex blobs — which is what stops one recurring error from looking like
 * forty unrelated ones.
 *
 * Give it the human message, not a serialised envelope: the quoted-fragment
 * rule turns `{"name":"Error","message":"..."}` into `{"<value>":"<value>"}`,
 * which is the same string for every JSON-shaped error there has ever been.
 */
export function normalizeErrorShape(error: string): string {
  return (
    error
      .replace(/https?:\/\/\S+/g, "<url>")
      // Before the bare-hex rule: a UUID's middle groups are four characters, so
      // that rule alone eats only the ends and leaves the rest varying, which
      // splits one recurring error across as many signatures as it has occurred.
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        "<id>",
      )
      .replace(/\b[0-9a-f]{8,}\b/gi, "<id>")
      .replace(/"[^"]*"/g, '"<value>"')
      .replace(/'[^']*'/g, "'<value>'")
      // No trailing boundary: a duration is written `30000ms`, and `\b` between
      // a digit and a letter does not match, so requiring one left every timeout
      // error carrying its own duration as a group of one.
      .replace(/\b\d+(\.\d+)?/g, "<n>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200)
  );
}

/**
 * Identity of a failure mode: what failed, and in what way.
 *
 * Keyed on the criterion TEXT, deliberately not on the scenario-scoped
 * criterion id. Criterion identity is scoped to its scenario because a trend
 * has to follow one scenario's criterion over time — but a failure GROUP is
 * about the mechanism, and "stays on topic" failing in three different
 * scenarios is one problem with the agent, not three. Keying the group on the
 * scenario-scoped id would split exactly the pattern most worth seeing; the
 * group still records which scenarios it spans.
 *
 * The kind is part of the identity so a scenario that errored before the judge
 * ran never shares a signature with one that was judged and failed. They look
 * similar in a list and mean opposite things — one says something about the
 * agent, the other says something about the infrastructure.
 */
export function signatureIdFor({
  kind,
  unmetCriteria,
  errorShape,
}: {
  kind: FailureSignature["kind"];
  unmetCriteria: string[];
  errorShape: string | null;
}): string {
  return `s_${shortHash([
    kind,
    [...unmetCriteria].map(normalizeCriterion).sort().join(","),
    errorShape ?? "",
  ])}`;
}

import {
  isOverengineeringSource,
  overengineeringFindings,
} from "../../grammar/overengineering.mjs";

// The one pass the three over-abstraction rules share: each once asked the
// detectors separately, analysing every `.ts` file three times; now computed
// once per program. Keyed by the Program node itself, so it cannot go stale -
// a new parse is a new node, and a freed one takes its entry with it.

const findingsByProgram = new WeakMap();
const NO_FINDINGS = Object.freeze([]);

/** A finding needs a `class`, a conditional `extends`, or both `true` and `false` literal types. */
function mayHoldAFinding(text) {
  return (
    text.includes("class") ||
    text.includes("extends") ||
    (text.includes("true") && text.includes("false"))
  );
}

/** Only the over-abstraction sources: no declarations, tests or generated code. */
export function isOverengineeringFile(file) {
  return !file.workspacePath.startsWith("../") && isOverengineeringSource(file.workspacePath);
}

/**
 * The findings of one policy for the file under the cursor.
 *
 * @param {object} input
 * @param {object} input.context The oxlint rule context.
 * @param {import("../classify.mjs").FileClassification} input.file
 * @param {string} input.policy
 * @param {object} input.program The `Program` node the rule's visitor was handed.
 */
export function reportsFor({ context, file, policy, program }) {
  let findings = findingsByProgram.get(program);
  if (!findings && !mayHoldAFinding(context.sourceCode.text)) return NO_FINDINGS;
  if (!findings) {
    findings = overengineeringFindings({
      path: file.filename,
      program,
      text: context.sourceCode.text,
    });
    findingsByProgram.set(program, findings);
  }

  return findings.filter((finding) => finding.policy === policy);
}

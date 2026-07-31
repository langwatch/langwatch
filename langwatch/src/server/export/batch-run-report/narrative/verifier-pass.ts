import { createLogger } from "@langwatch/observability";
import { generateObject } from "ai";
import { z } from "zod";
import type { Claim } from "../report.types";
import { VERIFIER_SYSTEM_PROMPT } from "./prompts";

const logger = createLogger("langwatch:batch-run-report:verifier");

/**
 * The second reading, which decides what survives.
 *
 * It returns booleans and nothing else. A checker that may rewrite is a second
 * author, and its edits would arrive with no citations and no third pass to
 * check them.
 *
 * It is given the byte-identical evidence the writer saw, so the two passes
 * provably reasoned over the same facts.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

const verdictSchema = z.object({
  verdicts: z.array(
    z.object({
      claimId: z.string(),
      supported: z.boolean(),
      reason: z
        .string()
        .max(200)
        .optional()
        .describe("Required when unsupported, so the call can be audited."),
    }),
  ),
});

/**
 * Below this share of statements reviewed, the pass is treated as broken rather
 * than as a verdict.
 *
 * Statements the checker never mentioned are dropped — an unreviewed statement
 * is not a confirmed one. But a response that skipped almost everything is a
 * malformed reply, not a finding that the report was almost entirely wrong, and
 * obeying it would empty a report that was fine.
 */
const MIN_COVERAGE_TO_TRUST = 0.5;

export interface VerifierOutcome {
  /** Claim ids the checker affirmatively supported. */
  supported: Set<string>;
  /** False when the response was too incomplete to act on. */
  isUsable: boolean;
}

export async function runVerifierPass({
  evidenceBlock,
  claims,
  resolveModel,
  abortSignal,
}: {
  evidenceBlock: string;
  claims: Claim[];
  resolveModel: () => Promise<Parameters<typeof generateObject>[0]["model"]>;
  abortSignal?: AbortSignal;
}): Promise<VerifierOutcome | null> {
  if (claims.length === 0) {
    return { supported: new Set(), isUsable: true };
  }

  try {
    const model = await resolveModel();
    const { object } = await generateObject({
      model,
      schemaName: "RunReportCheck",
      schemaDescription: "One verdict per statement id.",
      schema: verdictSchema,
      system: VERIFIER_SYSTEM_PROMPT,
      prompt: [
        `EVIDENCE\n\n${evidenceBlock}`,
        "",
        "STATEMENTS",
        ...claims.map((claim) => `${claim.id}: ${claim.text}`),
      ].join("\n"),
      temperature: 0,
      abortSignal,
    });

    const ruledOn = rulingsByClaim({ verdicts: object.verdicts, claims });
    const isUsable = ruledOn.size >= claims.length * MIN_COVERAGE_TO_TRUST;

    if (!isUsable) {
      logger.warn(
        { reviewed: ruledOn.size, total: claims.length },
        "Run report check reviewed too few statements to act on",
      );
    }

    return {
      supported: new Set(
        [...ruledOn]
          .filter(([, isSupported]) => isSupported)
          .map(([claimId]) => claimId),
      ),
      isUsable,
    };
  } catch (error) {
    // Same reasoning as the narrative pass: an abort is a cancellation, not a
    // degradation, and must not be turned into an unchecked report.
    if (error instanceof Error && error.name === "AbortError") throw error;
    logger.warn({ error }, "Run report check failed; leaving report unchecked");
    return null;
  }
}

/**
 * One ruling per claim, first verdict winning.
 *
 * A model repeating a claim id is an ordinary `generateObject` failure mode,
 * and left alone it breaks both values derived from this: a count of verdicts
 * would let twenty rulings on one claim pass a gate meant to prove breadth,
 * and a later `supported: true` would overwrite an earlier `false`. Taking the
 * first is the conservative half of that.
 */
function rulingsByClaim({
  verdicts,
  claims,
}: {
  verdicts: { claimId: string; supported: boolean }[];
  claims: Claim[];
}): Map<string, boolean> {
  const known = new Set(claims.map((claim) => claim.id));
  const ruledOn = new Map<string, boolean>();
  for (const verdict of verdicts) {
    if (!known.has(verdict.claimId) || ruledOn.has(verdict.claimId)) continue;
    ruledOn.set(verdict.claimId, verdict.supported);
  }
  return ruledOn;
}

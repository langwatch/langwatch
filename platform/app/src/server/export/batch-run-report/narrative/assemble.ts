import type { QuestionDescriptor } from "../questions/question-registry";
import type {
  Block,
  Claim,
  ReportEvidence,
  ReportIntegrity,
  ReportSection,
} from "../report.types";
import {
  buildCitationIndex,
  humaniseRunIds,
  resolveClaims,
  toCitation,
} from "./citation-resolver";
import type { DraftAnswer, DraftCitation, DraftReport } from "./narrative-pass";
import type { VerifierOutcome } from "./verifier-pass";
import { buildWrittenBlocks } from "./written-blocks";

/**
 * Turns the computed evidence, the draft and the verdicts into the document.
 *
 * This is where the report's central promise is kept: a question always appears,
 * and it either answers or says why it cannot. A section that quietly vanished
 * because the model skipped it would be indistinguishable, to a reader, from a
 * question whose answer was "everything is fine".
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

export interface AssembleResult {
  sections: ReportSection[];
  integrity: ReportIntegrity;
}

/**
 * Every claim that survived citation resolution, wherever it ended up.
 *
 * The checker can only be asked about claims that already exist, and claims
 * only get their ids during assembly — so assembly runs once to produce them,
 * the checker rules on them, and assembly runs again with the verdicts. It is a
 * pure function over the same inputs, so the second run is free of surprises.
 */
export function collectClaims(sections: ReportSection[]): Claim[] {
  const claims: Claim[] = [];

  for (const section of sections) {
    for (const block of section.written) {
      switch (block.kind) {
        case "claims":
          claims.push(...block.claims);
          break;
        case "findings":
          claims.push(...block.findings.flatMap((finding) => finding.claims));
          break;
        case "artifacts":
          claims.push(...block.artifacts.flatMap((it) => it.claims));
          break;
        default:
          break;
      }
    }
  }

  return claims;
}

export function assembleSections({
  evidence,
  questions,
  draft,
  verdicts,
  withAnalysis = true,
}: {
  evidence: ReportEvidence;
  questions: QuestionDescriptor[];
  draft: DraftReport | null;
  verdicts: VerifierOutcome | null;
  /** False when the reader chose the figures and skipped Langy entirely. */
  withAnalysis?: boolean;
}): AssembleResult {
  const index = buildCitationIndex({ evidence });
  const answersById = new Map(
    (draft?.answers ?? []).map((answer) => [answer.questionId, answer]),
  );
  const integrity: ReportIntegrity = {
    claimsDroppedUncited: 0,
    claimsDroppedUnresolvable: 0,
    claimsDroppedUnconfirmed: 0,
    notes: [],
  };

  const admit = ({
    claims,
    questionId,
    offset,
  }: {
    claims: { text: string; citations: DraftCitation[] }[];
    questionId: string;
    offset: number;
  }): Claim[] => {
    const identified: Claim[] = claims.map((claim, position) => ({
      id: `${questionId}#${offset + position}`,
      // Before anything reads it: the id belongs in the citation, not in the
      // sentence, where it is unreadable and already present underneath.
      text: humaniseRunIds({ text: claim.text, evidence }),
      // A citation that names no id is dropped here rather than rejected at
      // parse time, where it would have cost every answer instead of one.
      citations: claim.citations
        .map(toCitation)
        .filter((citation): citation is Claim["citations"][number] =>
          Boolean(citation),
        ),
    }));

    const resolved = resolveClaims({ claims: identified, index });
    integrity.claimsDroppedUncited += resolved.droppedUncited;
    integrity.claimsDroppedUnresolvable += resolved.droppedUnresolvable;

    if (!verdicts?.isUsable) return resolved.kept;

    const confirmed = resolved.kept.filter((claim) =>
      verdicts.supported.has(claim.id),
    );
    integrity.claimsDroppedUnconfirmed +=
      resolved.kept.length - confirmed.length;
    return confirmed;
  };

  const sections = questions.map((descriptor) => {
    const applicability = descriptor.applicability(evidence);
    if (!applicability.applicable) {
      return toSection({
        descriptor,
        computed: [],
        written: [],
        gap: applicability.reason,
      });
    }

    const computed = descriptor.computed(evidence);
    const written = answersById.has(descriptor.id)
      ? buildWrittenBlocks({
          answer: answersById.get(descriptor.id)!,
          evidence,
          admit,
        })
      : [];

    const gap =
      computed.length === 0 && written.length === 0
        ? gapReasonFor({
            answer: answersById.get(descriptor.id),
            draft,
            withAnalysis,
          })
        : null;

    return toSection({ descriptor, computed, written, gap });
  });

  return { sections, integrity };
}

function toSection({
  descriptor,
  computed,
  written,
  gap,
}: {
  descriptor: QuestionDescriptor;
  computed: Block[];
  written: Block[];
  gap: string | null;
}): ReportSection {
  return {
    questionId: descriptor.id,
    tier: descriptor.tier,
    question: descriptor.question,
    intent: descriptor.intent,
    computed,
    written,
    gap,
  };
}

function gapReasonFor({
  answer,
  draft,
  withAnalysis,
}: {
  answer: DraftAnswer | undefined;
  draft: DraftReport | null;
  withAnalysis: boolean;
}): string {
  if (draft === null) {
    // The three future.* questions are the ones that cannot be computed, so
    // this note is where a reader of an instant export learns what waiting
    // would buy them — and where a reader of a failed one learns it broke.
    return withAnalysis
      ? "This question needs Langy's analysis, which was not available for this report."
      : "Only Langy can answer this one. Export this run again with Langy to get it.";
  }
  if (answer?.declined && answer.declinedReason) {
    return answer.declinedReason;
  }
  return "There was not enough evidence in this run to answer this.";
}

import {
  bySeverityDescending,
  computeSeverityPrior,
} from "../evidence/severity";
import type { QuestionDescriptor } from "../questions/question-registry";
import type {
  Artifact,
  Block,
  Claim,
  Finding,
  ReportEvidence,
  ReportIntegrity,
  ReportSection,
  Severity,
} from "../report.types";
import { buildCitationIndex, resolveClaims } from "./citation-resolver";
import type { DraftAnswer, DraftReport } from "./narrative-pass";
import type { VerifierOutcome } from "./verifier-pass";

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
}: {
  evidence: ReportEvidence;
  questions: QuestionDescriptor[];
  draft: DraftReport | null;
  verdicts: VerifierOutcome | null;
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
    claims: { text: string; citations: Claim["citations"] }[];
    questionId: string;
    offset: number;
  }): Claim[] => {
    const identified: Claim[] = claims.map((claim, position) => ({
      id: `${questionId}#${offset + position}`,
      text: claim.text,
      citations: claim.citations,
    }));

    const resolved = resolveClaims({ claims: identified, index });
    integrity.claimsDroppedUncited += resolved.droppedUncited;
    integrity.claimsDroppedUnresolvable += resolved.droppedUnresolvable;

    if (!verdicts?.usable) return resolved.kept;

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
        ? gapReasonFor({ answer: answersById.get(descriptor.id), draft })
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
}: {
  answer: DraftAnswer | undefined;
  draft: DraftReport | null;
}): string {
  if (draft === null) {
    return "This question needs the written analysis, which was not available for this report.";
  }
  if (answer?.declined && answer.declinedReason) {
    return answer.declinedReason;
  }
  return "There was not enough evidence in this run to answer this.";
}

type Admit = (params: {
  claims: { text: string; citations: Claim["citations"] }[];
  questionId: string;
  offset: number;
}) => Claim[];

function buildWrittenBlocks({
  answer,
  evidence,
  admit,
}: {
  answer: DraftAnswer;
  evidence: ReportEvidence;
  admit: Admit;
}): Block[] {
  const blocks: Block[] = [];
  let offset = 0;

  // A group's supporting statements are admitted alongside the answer's own so
  // they end up in a `claims` block rather than flattened into group detail
  // text. A statement buried in a string is invisible to the checker, and an
  // unchecked statement is exactly what this pipeline exists to prevent.
  const statements = [
    ...(answer.statements ?? []),
    ...(answer.groups ?? []).flatMap((group) => group.statements ?? []),
  ];
  const claims = admit({
    claims: statements,
    questionId: answer.questionId,
    offset,
  });
  offset += statements.length;
  if (claims.length > 0) blocks.push({ kind: "claims", claims });

  const groups = buildGroupBlock({ answer, evidence });
  if (groups) blocks.push(groups);

  const findings = buildFindingsBlock({ answer, evidence, admit, offset });
  offset += countFindingClaims(answer);
  if (findings) blocks.push(findings);

  const artifacts = buildArtifactsBlock({ answer, admit, offset });
  if (artifacts) blocks.push(artifacts);

  return blocks;
}

function countFindingClaims(answer: DraftAnswer): number {
  return (answer.findings ?? []).reduce(
    (sum, finding) => sum + (finding.statements?.length ?? 0),
    0,
  );
}

/**
 * Expands the model's group ids into members.
 *
 * The model names a group and says which failure groups it covers; the
 * membership comes from the evidence. That is what lets a group honestly say it
 * covers forty scenarios when only three of their conversations were read, and
 * why a group cannot list a scenario that did not fail. A group naming an id
 * that is not in the evidence is dropped whole.
 */
function buildGroupBlock({
  answer,
  evidence,
}: {
  answer: DraftAnswer;
  evidence: ReportEvidence;
}): Block | null {
  const known = new Map(
    evidence.signatures.map((signature) => [signature.signatureId, signature]),
  );

  const groups = (answer.groups ?? [])
    .filter((group) => group.signatureIds.every((id) => known.has(id)))
    .map((group) => {
      const members = group.signatureIds.flatMap(
        (id) => known.get(id)?.runIds ?? [],
      );
      const scenarioNames = [
        ...new Set(
          members.map(
            (runId) =>
              evidence.runs.find((run) => run.runId === runId)?.scenarioName ??
              runId,
          ),
        ),
      ];

      return {
        title: group.name,
        subtitle: `${members.length} ${members.length === 1 ? "scenario" : "scenarios"}`,
        tone: "fail" as const,
        detail: [
          { label: "What went wrong", body: group.mechanism },
          { label: "Scenarios", body: scenarioNames.join(", ") },
        ],
      };
    });

  return groups.length > 0 ? { kind: "groups", groups } : null;
}

function buildFindingsBlock({
  answer,
  evidence,
  admit,
  offset,
}: {
  answer: DraftAnswer;
  evidence: ReportEvidence;
  admit: Admit;
  offset: number;
}): Block | null {
  const trendByCriterion = new Map(
    evidence.trend.map((fact) => [fact.criterionId, fact.classification]),
  );
  const worstComputed = evidence.signatures
    .map((signature) =>
      computeSeverityPrior({
        signature,
        trendByCriterion,
        settledRuns: evidence.counts.settledCount,
      }),
    )
    .sort(bySeverityDescending)[0];
  let cursor = offset;

  const findings: Finding[] = (answer.findings ?? [])
    .map((finding) => {
      const claims = admit({
        claims: finding.statements ?? [],
        questionId: answer.questionId,
        offset: cursor,
      });
      cursor += finding.statements?.length ?? 0;
      return {
        headline: finding.headline,
        severity: finding.severity as Severity,
        computedSeverity: worstComputed ?? ("low" as Severity),
        consequence: finding.consequence,
        claims,
      };
    })
    .filter((finding) => finding.claims.length > 0)
    .sort((a, b) => bySeverityDescending(a.severity, b.severity));

  return findings.length > 0 ? { kind: "findings", findings } : null;
}

function buildArtifactsBlock({
  answer,
  admit,
  offset,
}: {
  answer: DraftAnswer;
  admit: Admit;
  offset: number;
}): Block | null {
  let cursor = offset;

  const artifacts: Artifact[] = (answer.artifacts ?? [])
    .map((artifact) => {
      const claims = admit({
        claims: artifact.statements ?? [],
        questionId: answer.questionId,
        offset: cursor,
      });
      cursor += artifact.statements?.length ?? 0;
      return {
        artifactType: artifact.artifactType,
        title: artifact.title,
        rationale: artifact.rationale,
        body: artifact.body,
        claims,
      };
    })
    // A proposal with nothing behind it is advice, and advice is what this
    // section exists to avoid.
    .filter((artifact) => artifact.claims.length > 0);

  return artifacts.length > 0 ? { kind: "artifacts", artifacts } : null;
}

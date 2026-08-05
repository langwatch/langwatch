/**
 * Turning one question's draft answer into blocks.
 *
 * Everything a model wrote passes through `admit` on the way in, so a claim
 * that cites nothing, or cites something not in this run, never reaches a
 * block. The group builder is the important one: the model emits signature
 * ids and this expands them to member runs, so a group can honestly list forty
 * runs when three of their conversations were read, and cannot name a scenario
 * that did not fail.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

import {
  bySeverityDescending,
  computeSeverityPrior,
} from "../evidence/severity";
import type {
  Artifact,
  Block,
  Claim,
  Finding,
  ReportEvidence,
  Severity,
} from "../report.types";
import { humaniseRunIds } from "./citation-resolver";
import type { DraftAnswer, DraftCitation } from "./narrative-pass";

/**
 * The citation gate, as a function the block builders are handed.
 *
 * Passing it in rather than importing it keeps assembly the only place that
 * decides what survives resolution, so no block builder can quietly bypass it.
 */
export type Admit = (params: {
  claims: { text: string; citations: DraftCitation[] }[];
  questionId: string;
  offset: number;
}) => Claim[];

export function buildWrittenBlocks({
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

  const own = answer.statements ?? [];
  const claims = admit({
    claims: own,
    questionId: answer.questionId,
    offset,
  });
  offset += own.length;

  // A group's supporting statements are admitted so they land in the `claims`
  // block rather than flattened into group detail text — a statement buried in
  // a string is invisible to the checker, and an unchecked statement is exactly
  // what this pipeline exists to prevent.
  //
  // Admitted PER GROUP, because the group's own name and mechanism are model
  // prose too, and they were reaching the page whether or not anything backed
  // them: a fabricated group title and a fabricated account of what the agent
  // did wrong rendered under a footer reporting nothing removed. A group now
  // has to bring at least one statement that survives resolution before its
  // wording is shown. Nothing is lost when one does not — the deterministic
  // failure groups are computed from the evidence and always render.
  const supportedGroups: NonNullable<DraftAnswer["groups"]> = [];
  for (const group of answer.groups ?? []) {
    const statements = group.statements ?? [];
    const groupClaims = admit({
      claims: statements,
      questionId: answer.questionId,
      offset,
    });
    offset += statements.length;
    if (groupClaims.length > 0) {
      supportedGroups.push(group);
      claims.push(...groupClaims);
    }
  }
  if (claims.length > 0) blocks.push({ kind: "claims", claims });

  const groups = buildGroupBlock({
    answer: { ...answer, groups: supportedGroups },
    evidence,
  });
  if (groups) blocks.push(groups);

  const findings = buildFindingsBlock({ answer, evidence, admit, offset });
  offset += countFindingClaims(answer);
  if (findings) blocks.push(findings);

  const artifacts = buildArtifactsBlock({ answer, evidence, admit, offset });
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
        title: humaniseRunIds({ text: group.name, evidence }),
        subtitle: `${members.length} ${members.length === 1 ? "scenario" : "scenarios"}`,
        tone: "fail" as const,
        isWrittenByModel: true,
        detail: [
          {
            label: "What went wrong",
            body: humaniseRunIds({ text: group.mechanism, evidence }),
          },
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
  const priorBySignature = severityPriors(evidence);
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
        headline: humaniseRunIds({ text: finding.headline, evidence }),
        severity: finding.severity as Severity,
        computedSeverity: priorForCitedSignatures({ claims, priorBySignature }),
        consequence: humaniseRunIds({ text: finding.consequence, evidence }),
        claims,
      };
    })
    .filter((finding) => finding.claims.length > 0)
    .sort((a, b) => bySeverityDescending(a.severity, b.severity));

  return findings.length > 0 ? { kind: "findings", findings } : null;
}

/** The computed prior for each failure group, ready to look up by id. */
function severityPriors(evidence: ReportEvidence): Map<string, Severity> {
  const trendByCriterion = new Map(
    evidence.trend.map((fact) => [fact.criterionId, fact.classification]),
  );
  return new Map(
    evidence.signatures.map((signature) => [
      signature.signatureId,
      computeSeverityPrior({
        signature,
        trendByCriterion,
        settledRuns: evidence.counts.settledCount,
      }),
    ]),
  );
}

/**
 * The worst prior among the failure groups this finding's own statements cite.
 *
 * The model writes a finding as prose plus supporting statements, and the
 * statements are where it says which groups the finding is about — so the
 * citations are the only honest link between a finding and a computed prior.
 * A finding citing no group gets no prior, and the renderer shows no second
 * opinion for it rather than inventing one.
 */
function priorForCitedSignatures({
  claims,
  priorBySignature,
}: {
  claims: Claim[];
  priorBySignature: Map<string, Severity>;
}): Severity | null {
  const cited = claims
    .flatMap((claim) => claim.citations)
    .filter((citation) => citation.kind === "signature")
    .map((citation) => priorBySignature.get(citation.signatureId))
    .filter((severity): severity is Severity => severity !== undefined);

  return cited.length === 0 ? null : [...cited].sort(bySeverityDescending)[0]!;
}

function buildArtifactsBlock({
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
        title: humaniseRunIds({ text: artifact.title, evidence }),
        rationale: humaniseRunIds({ text: artifact.rationale, evidence }),
        // The body is a copyable artifact - a scenario definition, a line of
        // agent instructions, a guardrail rule - so it is left exactly as
        // written apart from the same id-for-name swap every other surface
        // gets. A rule naming a run id names something a reader cannot use.
        body: humaniseRunIds({ text: artifact.body, evidence }),
        claims,
      };
    })
    // A proposal with nothing behind it is advice, and advice is what this
    // section exists to avoid.
    .filter((artifact) => artifact.claims.length > 0);

  return artifacts.length > 0 ? { kind: "artifacts", artifacts } : null;
}

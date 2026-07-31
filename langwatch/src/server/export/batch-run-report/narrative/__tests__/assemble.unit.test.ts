/**
 * Unit tests for turning a draft into sections.
 *
 * These are the contract tests for the model layer. They never assert on prose,
 * because prose is not what the pipeline promises — they assert the properties
 * that must hold for ANY model output: every question appears, an unsupported
 * statement does not survive, and a group cannot claim a scenario that did not
 * fail.
 *
 * Adversarial drafts are hand-written rather than generated, so the bad cases
 * are exactly the ones a model produces on its worst day.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
import { describe, expect, it } from "vitest";
import { evidenceFixture } from "../../__tests__/evidence-fixture";
import { QUESTION_REGISTRY } from "../../questions/question-registry";
import type { Block } from "../../report.types";
import { assembleSections, collectClaims } from "../assemble";
import type { DraftReport } from "../narrative-pass";

const CITE_RUN_1 = [{ kind: "run" as const, runId: "run_1" }];

function assemble({
  draft,
  verdicts = null,
}: {
  draft: DraftReport | null;
  verdicts?: { supported: Set<string>; usable: boolean } | null;
}) {
  return assembleSections({
    evidence: evidenceFixture(),
    questions: QUESTION_REGISTRY,
    draft,
    verdicts,
  });
}

function writtenBlocksOf(
  sections: ReturnType<typeof assemble>["sections"],
  questionId: string,
): Block[] {
  return sections.find((it) => it.questionId === questionId)?.written ?? [];
}

describe("assembleSections() coverage of the registry", () => {
  describe("when the model answered nothing at all", () => {
    /** @scenario Every question the report asks appears in it */
    it("still emits one section per question", () => {
      const { sections } = assemble({ draft: { answers: [] } });

      expect(sections).toHaveLength(QUESTION_REGISTRY.length);
      expect(sections.map((it) => it.questionId)).toEqual(
        QUESTION_REGISTRY.map((it) => it.id),
      );
    });

    /** @scenario A question left with nothing to say is shown as a gap */
    it("marks a question with no computed content as a gap rather than dropping it", () => {
      const { sections } = assemble({ draft: { answers: [] } });
      const proposals = sections.find(
        (it) => it.questionId === "future.scenario",
      );

      expect(proposals).toBeDefined();
      expect(proposals?.gap).toBeTruthy();
    });
  });

  describe("when there is no draft at all", () => {
    /** @scenario A report still downloads when no model is configured */
    it("keeps every computed section and gaps only the written-only ones", () => {
      const { sections } = assemble({ draft: null });
      const outcome = sections.find((it) => it.questionId === "past.outcome");

      expect(sections).toHaveLength(QUESTION_REGISTRY.length);
      expect(outcome?.computed.length).toBeGreaterThan(0);
      expect(outcome?.gap).toBeNull();
      expect(
        sections.find((it) => it.questionId === "future.prompt")?.gap,
      ).toBeTruthy();
    });
  });

  describe("when a question does not apply to this run", () => {
    /** @scenario The first run of a suite reports no trend */
    it("explains why instead of leaving the section empty", () => {
      const { sections } = assemble({ draft: null });
      const regressions = sections.find(
        (it) => it.questionId === "past.regressions",
      );

      expect(regressions?.gap).toContain("No earlier run");
    });
  });
});

describe("assembleSections() admission of statements", () => {
  describe("when a statement cites a scenario that is not in this run", () => {
    /** @scenario A statement citing a scenario that does not exist is removed */
    it("does not let it reach a section", () => {
      const { sections, integrity } = assemble({
        draft: {
          answers: [
            {
              questionId: "past.outcome",
              declined: false,
              statements: [
                {
                  text: "Scenario nine timed out.",
                  citations: [{ kind: "run", runId: "run_invented" }],
                },
              ],
            },
          ],
        },
      });

      expect(writtenBlocksOf(sections, "past.outcome")).toEqual([]);
      expect(integrity.claimsDroppedUnresolvable).toBe(1);
    });
  });

  describe("when a statement cites nothing", () => {
    /** @scenario Removed statements are counted rather than hidden */
    it("counts the removal so the footer can report it", () => {
      const { integrity } = assemble({
        draft: {
          answers: [
            {
              questionId: "past.outcome",
              declined: false,
              statements: [
                { text: "The agent is getting worse.", citations: [] },
              ],
            },
          ],
        },
      });

      expect(integrity.claimsDroppedUncited).toBe(1);
    });
  });

  describe("when the check rejects a statement", () => {
    /** @scenario A statement the check could not confirm is removed */
    it("removes that statement and keeps the confirmed ones", () => {
      const draft: DraftReport = {
        answers: [
          {
            questionId: "past.outcome",
            declined: false,
            statements: [
              { text: "Confirmed statement.", citations: CITE_RUN_1 },
              { text: "Rejected statement.", citations: CITE_RUN_1 },
            ],
          },
        ],
      };
      const ids = collectClaims(assemble({ draft }).sections).map(
        (it) => it.id,
      );

      const { sections, integrity } = assemble({
        draft,
        verdicts: { supported: new Set([ids[0]!]), usable: true },
      });
      const claims = collectClaims(sections);

      expect(claims.map((it) => it.text)).toEqual(["Confirmed statement."]);
      expect(integrity.claimsDroppedUnconfirmed).toBe(1);
    });
  });

  describe("when the check never mentions a statement", () => {
    /** @scenario A statement the check never mentioned is removed */
    it("treats silence as unconfirmed rather than as approval", () => {
      const draft: DraftReport = {
        answers: [
          {
            questionId: "past.outcome",
            declined: false,
            statements: [
              { text: "Unreviewed statement.", citations: CITE_RUN_1 },
            ],
          },
        ],
      };

      const { sections } = assemble({
        draft,
        verdicts: { supported: new Set(), usable: true },
      });

      expect(collectClaims(sections)).toEqual([]);
    });
  });
});

describe("assembleSections() failure grouping", () => {
  describe("when the model names a group that exists", () => {
    /** @scenario Failures are grouped by what went wrong */
    it("expands membership from the evidence rather than from the model", () => {
      const { sections } = assemble({
        draft: {
          answers: [
            {
              questionId: "present.clusters",
              declined: false,
              groups: [
                {
                  name: "Leaks under pressure",
                  mechanism: "The agent concedes when the user escalates.",
                  signatureIds: ["s_known"],
                },
              ],
            },
          ],
        },
      });
      const groups = writtenBlocksOf(sections, "present.clusters").find(
        (block) => block.kind === "groups",
      );

      expect(groups).toBeDefined();
      expect(groups?.kind === "groups" && groups.groups[0]?.subtitle).toBe(
        "1 scenario",
      );
      expect(
        groups?.kind === "groups" &&
          groups.groups[0]?.detail.some((it) =>
            it.body.includes("Refund escalation"),
          ),
      ).toBe(true);
    });
  });

  describe("when the model names a group that does not exist", () => {
    /** @scenario A group cannot claim a scenario that did not fail */
    it("drops the group whole", () => {
      const { sections } = assemble({
        draft: {
          answers: [
            {
              questionId: "present.clusters",
              declined: false,
              groups: [
                {
                  name: "Invented cluster",
                  mechanism: "Something that never happened.",
                  signatureIds: ["s_invented"],
                },
              ],
            },
          ],
        },
      });

      expect(writtenBlocksOf(sections, "present.clusters")).toEqual([]);
    });
  });
});

describe("assembleSections() proposals", () => {
  describe("when a proposal is supported by the evidence", () => {
    /** @scenario The report proposes work, not advice */
    it("offers it as something copyable rather than as a suggestion", () => {
      const { sections } = assemble({
        draft: {
          answers: [
            {
              questionId: "future.scenario",
              declined: false,
              artifacts: [
                {
                  artifactType: "scenario",
                  title: "Cover the escalation path",
                  rationale: "Nothing probes what happens after a refusal.",
                  body: 'name: escalation\ncriteria:\n  - "stays polite"',
                  statements: [
                    { text: "Politeness failed here.", citations: CITE_RUN_1 },
                  ],
                },
              ],
            },
          ],
        },
      });
      const block = writtenBlocksOf(sections, "future.scenario").find(
        (it) => it.kind === "artifacts",
      );

      expect(block?.kind === "artifacts" && block.artifacts[0]?.body).toContain(
        "name: escalation",
      );
    });
  });

  describe("when a proposal cites nothing real", () => {
    /** @scenario A proposal that cannot be traced to a failure is not offered */
    it("is not offered", () => {
      const { sections } = assemble({
        draft: {
          answers: [
            {
              questionId: "future.scenario",
              declined: false,
              artifacts: [
                {
                  artifactType: "scenario",
                  title: "Untraceable proposal",
                  rationale: "Because.",
                  body: "name: something",
                  statements: [{ text: "Needed.", citations: [] }],
                },
              ],
            },
          ],
        },
      });

      expect(writtenBlocksOf(sections, "future.scenario")).toEqual([]);
      expect(
        sections.find((it) => it.questionId === "future.scenario")?.gap,
      ).toBeTruthy();
    });
  });
});

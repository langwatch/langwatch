import { describe, expect, it } from "vitest";
import { codingAgentSessionFoldStore } from "../../../pipelines/coding-agent-processing/projections/codingAgentSession.store";
import { evaluationAnalyticsFoldStore } from "../../../pipelines/evaluation-processing/projections/evaluationAnalytics.store";
import type { FoldCodec, VersionedRow } from "../foldCodec";
import {
  assertGenerationRatchet,
  type RatchetSubject,
  type RecordedGeneration,
} from "../generationRatchet";

/**
 * The ratchet, in the idiom this repo already uses for its other
 * "you may not quietly widen this" lists (`LEGACY_INERT`,
 * `KNOWN_RULE1_VIOLATIONS`, `tools/migrationorder`): the recorded state is
 * checked in HERE, next to the assertion, so changing what a fold reads back
 * without declaring a shape for it is a failing test rather than a silent
 * production decode.
 *
 * To add a fold store: import its definition into `subjects` and add its
 * record. To change what one reads back: declare a generation, raise
 * `readBackSince` to it, and update its record — in the same commit, which is
 * exactly the paired edit the ratchet exists to force.
 */
const RECORDED_GENERATIONS: Readonly<Record<string, RecordedGeneration>> = {
  evaluation_analytics: {
    generations: 1,
    reads: "1cc7158402bef385",
  },
  coding_agent_sessions: {
    generations: 3,
    reads: "eba53d78f9b47959",
  },
};

const subjects: readonly RatchetSubject[] = [
  evaluationAnalyticsFoldStore,
  codingAgentSessionFoldStore,
] as unknown as readonly RatchetSubject[];

describe("fold store generation ratchet", () => {
  describe("given every fold store as it stands today", () => {
    /** @scenario declaring a new shape alongside the change is accepted */
    it("matches its recorded generation", () => {
      expect(() =>
        assertGenerationRatchet({ subjects, recorded: RECORDED_GENERATIONS }),
      ).not.toThrow();
    });
  });

  describe("given a fold whose reads changed with no new shape declared", () => {
    /** @scenario changing what a fold reads back without saying so fails the build */
    it("fails, naming the fold and what changed", () => {
      // The recorded state stands in for "before the edit": same generation
      // count, different read-back list. This is the exact shape of the mistake
      // — someone adds a column to `decode` and does not bump.
      const stale: Record<string, RecordedGeneration> = {
        ...RECORDED_GENERATIONS,
        evaluation_analytics: {
          generations: evaluationAnalyticsFoldStore.codec.generations.length,
          reads: "a11ceb0000000000",
        },
      };

      expect(() =>
        assertGenerationRatchet({ subjects, recorded: stale }),
      ).toThrowErrorMatchingInlineSnapshot(`
        [Error: Fold store generation ratchet:
        - "evaluation_analytics" changed what it reads back (recorded "a11ceb0000000000", now "1cc7158402bef385") while still declaring 1 generation. Rows committed before this change do not carry the new read-back details, and nothing on them says so — they would decode short and be re-committed under the same stamp. Declare a new generation for the change, raise readBackSince to it, and record { generations: 2, reads: "1cc7158402bef385" }.]
      `);
    });
  });

  describe("given a fold whose reads changed and a new shape was declared for it", () => {
    it("asks only for the record to be updated, not for another shape", () => {
      const stale: Record<string, RecordedGeneration> = {
        ...RECORDED_GENERATIONS,
        coding_agent_sessions: { generations: 2, reads: "a11ceb0000000000" },
      };

      expect(() =>
        assertGenerationRatchet({ subjects, recorded: stale }),
      ).toThrow(/declared generation 3 but its recorded reads fingerprint/);
    });
  });

  describe("given a fold store with no record at all", () => {
    it("fails rather than guarding nothing", () => {
      expect(() =>
        assertGenerationRatchet({
          subjects,
          recorded: {
            coding_agent_sessions: RECORDED_GENERATIONS.coding_agent_sessions!,
          },
        }),
      ).toThrow(/no recorded generation/);
    });
  });

  describe("given a record for a fold store that no longer exists", () => {
    it("fails so the list only ever describes live folds", () => {
      expect(() =>
        assertGenerationRatchet({
          subjects,
          recorded: {
            ...RECORDED_GENERATIONS,
            retired_fold: { generations: 1, reads: "0000000000000000" },
          },
        }),
      ).toThrow(/no fold store declares it/);
    });
  });

  describe("given a fold that declares a shape without changing its reads", () => {
    it("is accepted — a shape can change for reasons a column list cannot show", () => {
      // The 2026-07-28 coding-agent bump is exactly this: the row shape was
      // unchanged, the recorded COUNTS were wrong, and the stamp moved anyway.
      const codec = {
        generations: [{ stamp: "a" }, { stamp: "b" }],
        readsFingerprint: "same",
      } as unknown as FoldCodec<unknown, VersionedRow>;

      expect(() =>
        assertGenerationRatchet({
          subjects: [{ name: "grown", codec }],
          recorded: { grown: { generations: 1, reads: "same" } },
        }),
      ).not.toThrow();
    });
  });
});

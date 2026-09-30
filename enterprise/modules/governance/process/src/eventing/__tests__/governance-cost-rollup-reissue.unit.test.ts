// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Port of main's fold key and reissue tests. Spec: specs/governance/governance-cost-rollup.feature */
import { describe, expect, it } from "vitest";

import { governanceCostRollupTotals } from "../../rules/governance-cost-rollup-cell.rules.ts";
import {
  DAY_START_MS,
  HOUR_MS,
  observed,
  retracted,
  rollupFold,
} from "./governance-cost-rollup.fixtures.ts";

const FIRST_PULL = DAY_START_MS + HOUR_MS;
const SECOND_PULL = DAY_START_MS + 5 * HOUR_MS;
const BILLED = 10_000_000_000;
const REISSUED = 11_000_000_000;

describe("the rollup cell an observed charge is keyed by", () => {
  describe("given two pulled items that differ only by spender", () => {
    /** @scenario "Two spenders with identical numbers stay two rows after compaction" */
    it("puts each spender in its own cell", () => {
      const { projection } = rollupFold();

      const ada = projection.key(observed({ restatementKey: "a", rawActorId: "user_ada" }));
      const grace = projection.key(observed({ restatementKey: "a", rawActorId: "user_grace" }));

      expect(ada).not.toBe(grace);
    });
  });

  describe("given two pulled items that differ only by agent", () => {
    it("puts each agent in its own cell", () => {
      const { projection } = rollupFold();

      const cell = projection.cellOf(observed({ restatementKey: "a", agentId: "space_1" }));

      expect(cell.agentId).toBe("space_1");
      expect(projection.key(observed({ restatementKey: "a" }))).not.toBe(
        projection.key(observed({ restatementKey: "a", agentId: "space_1" })),
      );
    });
  });

  describe("given an observation already on the log before charges named a spender", () => {
    it("reads it as the blank spender and agent", () => {
      const { projection } = rollupFold();

      const cell = projection.cellOf(observed({ restatementKey: "a" }));

      expect(cell).toMatchObject({ rawActorId: "", agentId: "" });
    });
  });

  describe("given an erased spender", () => {
    it("keys an observation under the stand-in, never the original", () => {
      const { projection } = rollupFold({ pseudonyms: new Map([["ada@corp", "digest-1"]]) });

      const cell = projection.cellOf(observed({ restatementKey: "a", rawActorId: "ada@corp" }));

      expect(cell.rawActorId).toBe("digest-1");
    });
  });
});

describe("a correction that lands in a different cell", () => {
  describe("when the provider reissues the same bill in another currency", () => {
    /** @scenario "A correction that arrives under a different currency retracts what it replaces" */
    it("empties the cell the first currency held and leaves the money in the second", () => {
      const { projection, fold } = rollupFold();
      const inEuros = observed({
        restatementKey: "bill",
        costNanoMinor: BILLED,
        currencyCode: "EUR",
        observedAtMs: FIRST_PULL,
      });
      const retraction = retracted({
        restatementKey: "bill",
        currencyCode: "EUR",
        observedAtMs: SECOND_PULL,
      });
      const inDollars = observed({
        restatementKey: "bill",
        costNanoMinor: REISSUED,
        observedAtMs: SECOND_PULL,
      });

      const emptied = fold([inEuros, retraction]);

      expect(governanceCostRollupTotals(emptied).amountNanoMinor).toBe(0);
      expect(emptied).toMatchObject({ revisionCount: 1, lastObservedAt: SECOND_PULL });
      expect(governanceCostRollupTotals(fold([inDollars])).amountNanoMinor).toBe(REISSUED);
      expect(projection.key(retraction)).toBe(projection.key(inEuros));
      expect(projection.key(inDollars)).not.toBe(projection.key(inEuros));
    });
  });

  describe("when the provider reissues the same charge against another spender", () => {
    /** @scenario "A correction that arrives against a different spender retracts what it replaces" */
    it("empties the cell the first spender held and leaves the money against the second", () => {
      const { projection, fold } = rollupFold();
      const againstFirst = observed({
        restatementKey: "charge",
        costNanoMinor: BILLED,
        rawActorId: "user_ada",
        observedAtMs: FIRST_PULL,
      });
      const retraction = retracted({
        restatementKey: "charge",
        rawActorId: "user_ada",
        observedAtMs: SECOND_PULL,
      });
      const againstSecond = observed({
        restatementKey: "charge",
        costNanoMinor: REISSUED,
        rawActorId: "user_grace",
        observedAtMs: SECOND_PULL,
      });

      const emptied = fold([againstFirst, retraction]);

      expect(governanceCostRollupTotals(emptied).amountNanoUsd).toBe(0);
      expect(emptied).toMatchObject({ revisionCount: 1, lastObservedAt: SECOND_PULL });
      expect(governanceCostRollupTotals(fold([againstSecond])).amountNanoUsd).toBe(REISSUED);
      expect(projection.key(retraction)).toBe(projection.key(againstFirst));
      expect(projection.key(againstSecond)).not.toBe(projection.key(againstFirst));
    });
  });
});

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { cellsBehindTheirEvents } from "../cost-rollup-summary-freshness.rules.ts";

const KEY = "2026-09-20|pulled|src_1|openai|gpt-5";
const at = (LastEventOccurredAt: number) => new Map([[KEY, { LastEventOccurredAt }]]);

describe("cellsBehindTheirEvents", () => {
  describe("given a pulled charge landed after the newest one the summary has folded", () => {
    /** @scenario A charge the summary has not folded yet is named as still folding */
    it("names the cell with both moments on it", () => {
      expect(cellsBehindTheirEvents({ derived: at(9_000), summarized: at(4_000) })).toEqual([
        { key: KEY, derivedLastEventOccurredAtMs: 9_000, summarizedLastEventOccurredAtMs: 4_000 },
      ]);
    });
  });

  describe("given a pulled charge whose rollup cell the summary holds no row for", () => {
    /** @scenario A cell the summary holds nothing for is named as still folding */
    it("names the cell with nothing folded into it", () => {
      expect(cellsBehindTheirEvents({ derived: at(9_000), summarized: new Map() })).toEqual([
        { key: KEY, derivedLastEventOccurredAtMs: 9_000, summarizedLastEventOccurredAtMs: null },
      ]);
    });
  });

  describe("given a pulled charge that carries no moment the summary can be measured against", () => {
    /** @scenario A charge carrying no usable moment is never named as still folding */
    it("names nothing, whether or not the summary holds the cell", () => {
      expect(cellsBehindTheirEvents({ derived: at(0), summarized: new Map() })).toEqual([]);
      expect(cellsBehindTheirEvents({ derived: at(0), summarized: at(4_000) })).toEqual([]);
    });
  });
});

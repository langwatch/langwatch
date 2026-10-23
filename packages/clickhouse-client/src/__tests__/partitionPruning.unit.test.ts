/**
 * Reading the pruned part count out of an EXPLAIN, in both layouts the supported servers print:
 * the indented plan before 26.7 and the `pretty` tree from it. Samples are real server output.
 */
import { describe, expect, it } from "vitest";

import { partsInExplain } from "../partitionPruning.ts";

const INDENTED = `Expression ((Project names + Projection))
  Expression ((WHERE + Change column names to column identifiers))
    ReadFromMergeTree (default.ex_t)
    Indexes:
      MinMax
        Keys:
          p
        Condition: (p in [1, 1])
        Parts: 1/3
        Granules: 1/3
      Partition
        Keys:
          p
        Condition: (p in [1, 1])
        Parts: 1/1
        Granules: 1/1
      PrimaryKey
        Keys:
          k
        Condition: (k in [6, +Inf))
        Parts: 1/1
        Granules: 1/1
        Search Algorithm: binary search
      Ranges: 1`;

const PRETTY_UNION = `Output: k

Union
├──ReadFromMergeTree (default.ex_t)
│     Read type: Default
│     Parts: 1 | Granules: 1
│     Indexes:
│       Min-Max
│         Keys:
│           p
│         Parts: 1/3
│         Granules: 1/3
│       Partition
│         Keys:
│           p
│         Parts: 1/1
│         Granules: 1/1
│       PrimaryKey
│         Parts: 1/1
│         Granules: 1/1
└──ReadFromMergeTree (default.ex_t)
      Read type: Default
      Parts: 2 | Granules: 2
      Indexes:
        Min-Max
          Parts: 2/3
          Granules: 2/3
        Partition
          Parts: 2/2
          Granules: 2/2
        PrimaryKey
          Condition: true
          Parts: 2/2
          Granules: 2/2`;

const NO_PARTITION_STAGE = `ReadFromMergeTree (default.ex_t)
Indexes:
  PrimaryKey
    Parts: 1/4
    Granules: 1/4`;

const lines = (text: string) => text.split("\n");

describe("partsInExplain", () => {
  describe("when the server prints the indented plan", () => {
    it("answers the parts the Partition stage kept", () => {
      expect(partsInExplain(lines(INDENTED))).toBe(1);
    });
  });

  describe("when the server prints the pretty tree", () => {
    it("strips the tree glyphs and sums every table scan", () => {
      expect(partsInExplain(lines(PRETTY_UNION))).toBe(3);
    });
  });

  describe("when a scan has no Partition stage", () => {
    it("answers every part that entered the scan", () => {
      expect(partsInExplain(lines(NO_PARTITION_STAGE))).toBe(4);
    });
  });
});

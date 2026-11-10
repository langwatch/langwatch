import { describe, expect, it } from "vitest";

import { partsInExplain } from "../partitionPruning.ts";

describe("partsInExplain", () => {
  it("reads the Partition stage of a flat plan", () => {
    expect(
      partsInExplain([
        "ReadFromMergeTree (db.stored_spans)",
        "  Indexes:",
        "    MinMax",
        "      Parts: 4/9",
        "    Partition",
        "      Parts: 2/4",
      ]),
    ).toBe(2);
  });

  it("reads nested steps behind the tree drawing newer servers print", () => {
    expect(
      partsInExplain([
        "CreatingSets (Create sets before main query execution)",
        "└──JoinLazyColumnsStep",
        "   │     └──ReadFromMergeTree (db.stored_spans)",
        "   │           Parts: 1 | Granules: 1",
        "   │           Indexes:",
        "   │             Min-Max",
        "   │               Parts: 4/4",
        "   │             Partition",
        "   │               Parts: 3/4",
        "   │             PrimaryKey",
        "   │               Parts: 1/1",
        "   └──LazilyReadFromMergeTree",
      ]),
    ).toBe(3);
  });

  it("sums every table scan, counting all parts when none were pruned by partition", () => {
    expect(
      partsInExplain([
        "├──ReadFromMergeTree (db.a)",
        "│    Indexes:",
        "│      MinMax",
        "│        Parts: 5/5",
        "└──ReadFromMergeTree (db.b)",
        "     Indexes:",
        "       Partition",
        "         Parts: 1/6",
      ]),
    ).toBe(6);
  });
});

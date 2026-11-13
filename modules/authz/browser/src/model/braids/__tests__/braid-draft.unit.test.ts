// Spec: modules/authz/specs/braids-screen.feature, "The dialog builds a braid": the draft's pure
// pieces the drawer is built on.

import type { AuthzBraid } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import {
  braidDraftChanged,
  braidDraftOf,
  braidTargetLabel,
  braidTargetOptions,
  braidsOnPair,
  pairBraidsPhrase,
  testTraceRows,
  withSignedCalls,
} from "../braid-draft.ts";

describe("withSignedCalls", () => {
  describe("when it is turned on", () => {
    it("adds Verified to an empty condition on its own", () => {
      expect(withSignedCalls({ where: "  ", on: true, key: "orchestrator" })).toBe(
        'Verified("orchestrator")',
      );
    });

    it("joins Verified to a written condition with and", () => {
      expect(withSignedCalls({ where: 'attributes["team"] == "a" ', on: true, key: "team" })).toBe(
        'attributes["team"] == "a" and Verified("team")',
      );
    });

    it("leaves a condition that already has Verified as it is", () => {
      const where = 'Verified("team") and attributes["team"] == "a"';
      expect(withSignedCalls({ where, on: true, key: "other" })).toBe(where);
    });
  });

  describe("when it is turned off", () => {
    it.each([
      ['attributes["team"] == "a" and Verified("team")', 'attributes["team"] == "a"'],
      ['Verified("team") and attributes["team"] == "a"', 'attributes["team"] == "a"'],
      ['Verified("team")', ""],
    ])("takes Verified out of %s", (where, expected) => {
      expect(withSignedCalls({ where, on: false, key: "team" })).toBe(expected);
    });
  });
});

describe("testTraceRows", () => {
  const node = (
    spanId: string,
    parentSpanId: string | null,
    startTimeMs: number,
    extra: { ownerProjectId?: string; braided?: boolean } = {},
  ) => ({ spanId, parentSpanId, name: `span ${spanId}`, startTimeMs, ...extra });

  it("orders parents before children, siblings by start, and marks each span's kind", () => {
    const rows = testTraceRows([
      node("c", "a", 30, { ownerProjectId: "p-spec", braided: false }),
      node("b", "a", 20, { ownerProjectId: "p-spec", braided: true }),
      node("a", null, 10),
    ]);

    expect(rows.map(({ spanId, depth, kind }) => ({ spanId, depth, kind }))).toEqual([
      { spanId: "a", depth: 0, kind: "own" },
      { spanId: "b", depth: 1, kind: "braided" },
      { spanId: "c", depth: 1, kind: "withheld" },
    ]);
  });

  it("puts a span whose parent is not in the trace at the top", () => {
    const rows = testTraceRows([node("x", "missing", 5)]);
    expect(rows).toEqual([{ spanId: "x", name: "span x", depth: 0, kind: "own" }]);
  });
});

describe("braidTargetLabel", () => {
  it("names a selectable project by its name", () => {
    expect(braidTargetLabel({ name: "orchestrator" })).toBe("orchestrator");
  });

  it("keeps a refused project's reason in its name", () => {
    expect(braidTargetLabel({ name: "payments-agent", reason: "This project" })).toBe(
      "payments-agent, this project",
    );
  });
});

describe("braidsOnPair", () => {
  const braid = (overrides: Partial<AuthzBraid>): AuthzBraid => ({
    braidId: "b-1",
    ownerProjectId: "p-spec",
    readerProjectId: "p-orch",
    where: null,
    fromMs: 0,
    expiresAtMs: null,
    createdByUserId: null,
    createdAtMs: 0,
    ...overrides,
  });

  it("lists the reader's live braids from this project, leaving out the edited and the ended", () => {
    const braids = [
      braid({ braidId: "b-1" }),
      braid({ braidId: "b-2" }),
      braid({ braidId: "b-3", expiresAtMs: 50 }),
      braid({ braidId: "b-4", readerProjectId: "p-other" }),
    ];

    expect(
      braidsOnPair({ braids, readerProjectId: "p-orch", editingBraidId: "b-2", nowMs: 100 }).map(
        (row) => row.braidId,
      ),
    ).toEqual(["b-1"]);
    expect(
      braidsOnPair({ braids, readerProjectId: undefined, editingBraidId: undefined, nowMs: 100 }),
    ).toEqual([]);
  });

  it("says what the reader already sees", () => {
    expect(
      pairBraidsPhrase({ readerName: "checkout-web", ownerName: "payments-agent", count: 1 }),
    ).toBe("checkout-web already sees spans from 1 braid from payments-agent");
    expect(
      pairBraidsPhrase({ readerName: "checkout-web", ownerName: "payments-agent", count: 2 }),
    ).toBe("checkout-web already sees spans from 2 braids from payments-agent");
  });
});

describe("braidDraftChanged", () => {
  const saved: AuthzBraid = {
    braidId: "b-1",
    ownerProjectId: "p-spec",
    readerProjectId: "p-orch",
    where: 'attributes["team"] == "a"',
    fromMs: 1_000,
    expiresAtMs: null,
    createdByUserId: null,
    createdAtMs: 0,
  };
  const nowMs = 5_000;

  it("says an edit that keeps every term is unchanged", () => {
    const draft = { ...braidDraftOf(saved), where: ' attributes["team"] == "a" ' };

    expect(braidDraftChanged({ draft, braid: saved, nowMs })).toBe(false);
  });

  it.each([
    ["the condition", { where: 'attributes["team"] == "b"' }],
    ["the start", { fromMs: 2_000 }],
    ["the end", { ends: { kind: "date" as const, dateMs: 9_000 } }],
    ["a relative end", { ends: { kind: "days" as const, days: 30 as const } }],
  ])("says an edit to %s is a change", (_term, edit) => {
    const draft = { ...braidDraftOf(saved), ...edit };

    expect(braidDraftChanged({ draft, braid: saved, nowMs })).toBe(true);
  });
});

describe("braidTargetOptions", () => {
  describe("when the braid's own project sits early in the host's list", () => {
    /** @scenario The braid starts from this project and picks where it goes */
    it("lists it last, the others in the host's order", () => {
      const { options } = braidTargetOptions({
        projects: [
          { id: "p-a", name: "alpha" },
          { id: "p-own", name: "specialists" },
          { id: "p-b", name: "beta" },
        ],
        targets: [
          { projectId: "p-a", selectable: true },
          { projectId: "p-own", selectable: false, reason: "this_project" },
          { projectId: "p-b", selectable: true },
        ],
      });

      expect(options.map((option) => option.projectId)).toEqual(["p-a", "p-b", "p-own"]);
    });
  });

  describe("when another project is refused for a different reason", () => {
    /** @scenario The braid starts from this project and picks where it goes */
    it("moves only the braid's own project, by its reason key rather than its words", () => {
      const { options } = braidTargetOptions({
        projects: [
          { id: "p-own", name: "specialists" },
          { id: "p-agg", name: "everything" },
          { id: "p-a", name: "alpha" },
        ],
        targets: [
          { projectId: "p-own", selectable: false, reason: "this_project" },
          { projectId: "p-agg", selectable: false, reason: "aggregate" },
          { projectId: "p-a", selectable: true },
        ],
      });

      expect(options.map((option) => option.projectId)).toEqual(["p-agg", "p-a", "p-own"]);
    });
  });
});

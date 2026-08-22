import { describe, expect, it } from "vitest";

import {
  type LinkTimelineRow,
  resolveOwnerAt,
  splitPeriodByOwnership,
} from "../resolution";

const at = (iso: string) => new Date(iso);

let nextSeq = 0n;
const row = (over: Partial<LinkTimelineRow>): LinkTimelineRow => ({
  seq: (nextSeq += 1n),
  userId: "alice",
  effectiveFrom: at("2026-01-01T00:00:00Z"),
  erasedAt: null,
  ...over,
});

describe("resolveOwnerAt — deterministic resolution (ADR-094 Invariants)", () => {
  it("resolves the highest effectiveFrom at or before the moment", () => {
    const rows = [
      row({ userId: "alice", effectiveFrom: at("2026-01-01T00:00:00Z") }),
      row({ userId: "bob", effectiveFrom: at("2026-03-01T00:00:00Z") }),
    ];
    expect(resolveOwnerAt(rows, at("2026-02-10T00:00:00Z"))).toEqual({
      kind: "person",
      userId: "alice",
    });
    expect(resolveOwnerAt(rows, at("2026-03-10T00:00:00Z"))).toEqual({
      kind: "person",
      userId: "bob",
    });
  });

  it("hands usage AT the handover boundary to the new owner", () => {
    const rows = [
      row({ userId: "alice", effectiveFrom: at("2026-01-01T00:00:00Z") }),
      row({ userId: "bob", effectiveFrom: at("2026-03-01T00:00:00Z") }),
    ];
    expect(resolveOwnerAt(rows, at("2026-03-01T00:00:00Z"))).toEqual({
      kind: "person",
      userId: "bob",
    });
  });

  it("equal effectiveFrom: seq wins, consistently, in any input order", () => {
    const when = at("2026-02-01T00:00:00Z");
    const wrong = row({ userId: "wrong-person", effectiveFrom: when });
    const correction = row({ userId: "right-person", effectiveFrom: when });
    expect(correction.seq > wrong.seq).toBe(true);

    for (const rows of [
      [wrong, correction],
      [correction, wrong],
    ]) {
      expect(resolveOwnerAt(rows, at("2026-02-15T00:00:00Z"))).toEqual({
        kind: "person",
        userId: "right-person",
      });
    }
  });

  it("a backdated correction fills periods no row covered", () => {
    const late = row({
      userId: "alice",
      effectiveFrom: at("2026-01-01T00:00:00Z"),
    });
    // Appended AFTER (higher seq) but effective EARLIER — Decision 3.
    const backdated = row({
      userId: "alice",
      effectiveFrom: at("2025-06-01T00:00:00Z"),
    });
    expect(
      resolveOwnerAt([late, backdated], at("2025-08-01T00:00:00Z")),
    ).toEqual({ kind: "person", userId: "alice" });
  });

  it("no covering row resolves to none (the unattributed bucket)", () => {
    const rows = [row({ effectiveFrom: at("2026-03-01T00:00:00Z") })];
    expect(resolveOwnerAt(rows, at("2026-01-15T00:00:00Z"))).toEqual({
      kind: "none",
    });
    expect(resolveOwnerAt([], at("2026-01-15T00:00:00Z"))).toEqual({
      kind: "none",
    });
  });

  it("an unlink row and an erased row stay distinguishable forever", () => {
    const unlink = row({ userId: null, erasedAt: null });
    expect(resolveOwnerAt([unlink], at("2026-06-01T00:00:00Z"))).toEqual({
      kind: "unlinked",
    });

    const erased = row({ userId: null, erasedAt: at("2026-05-01T00:00:00Z") });
    expect(resolveOwnerAt([erased], at("2026-06-01T00:00:00Z"))).toEqual({
      kind: "erased-person",
    });
  });
});

describe("splitPeriodByOwnership — period-correct attribution (ADR-094 Invariants)", () => {
  it("login owned by A Jan–Feb, B from Mar, links backfilled late: Q1 splits at March", () => {
    // Appended in reverse ("backfilled late"): the March row first, then the
    // January row. Order of appends must not matter — only effectiveFrom.
    const rows = [
      row({ userId: "bob", effectiveFrom: at("2026-03-01T00:00:00Z") }),
      row({ userId: "alice", effectiveFrom: at("2026-01-01T00:00:00Z") }),
    ];
    const q1 = splitPeriodByOwnership(
      rows,
      at("2026-01-01T00:00:00Z"),
      at("2026-04-01T00:00:00Z"),
    );
    expect(q1).toEqual([
      {
        from: at("2026-01-01T00:00:00Z"),
        to: at("2026-03-01T00:00:00Z"),
        resolution: { kind: "person", userId: "alice" },
      },
      {
        from: at("2026-03-01T00:00:00Z"),
        to: at("2026-04-01T00:00:00Z"),
        resolution: { kind: "person", userId: "bob" },
      },
    ]);
  });

  it("handover on Mar 15 splits March at the boundary — pre-15th on A, 15th-onward on B", () => {
    const rows = [
      row({ userId: "alice", effectiveFrom: at("2026-01-01T00:00:00Z") }),
      row({ userId: "bob", effectiveFrom: at("2026-03-15T00:00:00Z") }),
    ];
    const march = splitPeriodByOwnership(
      rows,
      at("2026-03-01T00:00:00Z"),
      at("2026-04-01T00:00:00Z"),
    );
    expect(march).toEqual([
      {
        from: at("2026-03-01T00:00:00Z"),
        to: at("2026-03-15T00:00:00Z"),
        resolution: { kind: "person", userId: "alice" },
      },
      {
        from: at("2026-03-15T00:00:00Z"),
        to: at("2026-04-01T00:00:00Z"),
        resolution: { kind: "person", userId: "bob" },
      },
    ]);
  });

  it("a correction re-asserting the same owner splits nothing", () => {
    const rows = [
      row({ userId: "alice", effectiveFrom: at("2026-01-01T00:00:00Z") }),
      row({ userId: "alice", effectiveFrom: at("2026-03-15T00:00:00Z") }),
    ];
    const march = splitPeriodByOwnership(
      rows,
      at("2026-03-01T00:00:00Z"),
      at("2026-04-01T00:00:00Z"),
    );
    expect(march).toEqual([
      {
        from: at("2026-03-01T00:00:00Z"),
        to: at("2026-04-01T00:00:00Z"),
        resolution: { kind: "person", userId: "alice" },
      },
    ]);
  });

  it("an uncovered stretch before the first link shows as none, not as the later owner", () => {
    const rows = [
      row({ userId: "alice", effectiveFrom: at("2026-03-15T00:00:00Z") }),
    ];
    const march = splitPeriodByOwnership(
      rows,
      at("2026-03-01T00:00:00Z"),
      at("2026-04-01T00:00:00Z"),
    );
    expect(march).toEqual([
      {
        from: at("2026-03-01T00:00:00Z"),
        to: at("2026-03-15T00:00:00Z"),
        resolution: { kind: "none" },
      },
      {
        from: at("2026-03-15T00:00:00Z"),
        to: at("2026-04-01T00:00:00Z"),
        resolution: { kind: "person", userId: "alice" },
      },
    ]);
  });

  it("boundaries outside the period never cut it", () => {
    const rows = [
      row({ userId: "alice", effectiveFrom: at("2026-01-01T00:00:00Z") }),
      row({ userId: "bob", effectiveFrom: at("2026-05-01T00:00:00Z") }),
    ];
    const march = splitPeriodByOwnership(
      rows,
      at("2026-03-01T00:00:00Z"),
      at("2026-04-01T00:00:00Z"),
    );
    expect(march).toEqual([
      {
        from: at("2026-03-01T00:00:00Z"),
        to: at("2026-04-01T00:00:00Z"),
        resolution: { kind: "person", userId: "alice" },
      },
    ]);
  });
});

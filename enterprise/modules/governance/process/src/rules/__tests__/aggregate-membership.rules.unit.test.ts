// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import {
  FULL_HISTORY_FROM,
  aggregateReadStart,
  aggregateReadWindowOf,
  decideAggregateMembership,
} from "../aggregate-membership.rules.ts";

const JOINED = "2026-09-01T10:00:00Z";
const NOW = "2026-10-09T03:17:00Z";
const fullHistory = (memberProjectId: string) => ({ memberProjectId, from: FULL_HISTORY_FROM });
const sinceJoin = (memberProjectId: string) => ({ memberProjectId, from: JOINED });

describe("aggregateReadWindowOf", () => {
  it("reads all-personal and explicit members over their full history", () => {
    expect(aggregateReadWindowOf("all-personal")).toBe("full-history");
    expect(aggregateReadWindowOf("explicit")).toBe("full-history");
  });

  it("reads a department's members only since they joined", () => {
    expect(aggregateReadWindowOf("personal-by-department")).toBe("since-attach");
  });
});

describe("aggregateReadStart", () => {
  it("starts a full-history read at the epoch, never at an absent start", () => {
    expect(aggregateReadStart({ window: "full-history", now: NOW })).toBe("1970-01-01T00:00:00Z");
  });

  it("starts a since-attach read now", () => {
    expect(aggregateReadStart({ window: "since-attach", now: NOW })).toBe(NOW);
  });
});

describe("decideAggregateMembership", () => {
  describe("given members the rule wants, some held and some not", () => {
    it("attaches the missing, revokes the unwanted and leaves the rest, each sorted", () => {
      expect(
        decideAggregateMembership({
          aggregateProjectId: "agg",
          desired: ["c", "a", "b"],
          held: [fullHistory("d"), fullHistory("b")],
          window: "full-history",
        }),
      ).toEqual({ attach: ["a", "c"], reattach: [], revoke: ["d"], unchanged: ["b"] });
    });
  });

  describe("given a rule that selects the aggregate itself", () => {
    it("never counts the aggregate as its own member", () => {
      expect(
        decideAggregateMembership({
          aggregateProjectId: "agg",
          desired: ["agg", "a"],
          held: [],
          window: "full-history",
        }),
      ).toEqual({ attach: ["a"], reattach: [], revoke: [], unchanged: [] });
    });
  });

  describe("given members that are current", () => {
    it("decides nothing new", () => {
      expect(
        decideAggregateMembership({
          aggregateProjectId: "agg",
          desired: ["a"],
          held: [fullHistory("a")],
          window: "full-history",
        }),
      ).toEqual({ attach: [], reattach: [], revoke: [], unchanged: ["a"] });
    });
  });

  describe("when a full-history rule holds a read that starts at its join date", () => {
    it("attaches that member again", () => {
      expect(
        decideAggregateMembership({
          aggregateProjectId: "agg",
          desired: ["a", "b"],
          held: [sinceJoin("a"), fullHistory("b")],
          window: "full-history",
        }),
      ).toEqual({ attach: [], reattach: ["a"], revoke: [], unchanged: ["b"] });
    });
  });

  describe("when a since-attach rule holds a read", () => {
    it("keeps any join-date start, whatever day it was", () => {
      expect(
        decideAggregateMembership({
          aggregateProjectId: "agg",
          desired: ["a", "b"],
          held: [sinceJoin("a"), { memberProjectId: "b", from: NOW }],
          window: "since-attach",
        }),
      ).toEqual({ attach: [], reattach: [], revoke: [], unchanged: ["a", "b"] });
    });

    it("attaches a full-history read again", () => {
      expect(
        decideAggregateMembership({
          aggregateProjectId: "agg",
          desired: ["a"],
          held: [fullHistory("a")],
          window: "since-attach",
        }),
      ).toEqual({ attach: [], reattach: ["a"], revoke: [], unchanged: [] });
    });
  });

  describe("when a held read has no readable start", () => {
    it("attaches it again under either window", () => {
      for (const window of ["full-history", "since-attach"] as const) {
        expect(
          decideAggregateMembership({
            aggregateProjectId: "agg",
            desired: ["a"],
            held: [{ memberProjectId: "a", from: null }],
            window,
          }).reattach,
        ).toEqual(["a"]);
      }
    });
  });

  describe("when a read on the wrong window belongs to a member the rule dropped", () => {
    it("revokes it rather than attaching it again", () => {
      expect(
        decideAggregateMembership({
          aggregateProjectId: "agg",
          desired: [],
          held: [sinceJoin("a")],
          window: "full-history",
        }),
      ).toEqual({ attach: [], reattach: [], revoke: ["a"], unchanged: [] });
    });
  });
});

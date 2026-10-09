import { describe, expect, it } from "vitest";

import { progressOf, waitingOnOf } from "../step-view.ts";

describe("progressOf", () => {
  describe("when the report carries done and total", () => {
    it("reads them as the step's progress", () => {
      expect(progressOf({ report: { done: 63, total: 100, cursor: "x" } })).toEqual({
        done: 63,
        total: 100,
      });
    });
  });

  describe("when the report lacks either key or holds no count", () => {
    it.each([null, { done: 3 }, { total: 9 }, { done: "3", total: 9 }, { done: 1, total: 0 }])(
      "reads no progress from %o",
      (report) => {
        expect(progressOf({ report })).toBeNull();
      },
    );
  });
});

describe("waitingOnOf", () => {
  const roster = [
    { role: "api", image: "3.21.0", release: "3.21.0", steps: ["ops:fill"], heartbeat_at: "t1" },
    { role: "worker", image: "3.20.1", release: "3.20.1", steps: [], heartbeat_at: "t2" },
  ];
  const declared = { id: "ops:fill", kind: "data", mode: "background", needsOldWritersGone: true };

  describe("when an unsettled step needs old writers gone", () => {
    it("lists the live processes whose image does not know the step", () => {
      expect(waitingOnOf({ id: "ops:fill", status: "pending", declared, roster })).toEqual([
        { role: "worker", image: "3.20.1", release: "3.20.1", lastSeenAt: "t2" },
      ]);
    });
  });

  describe("when only the image's code step lookup names the step", () => {
    it("lists the live processes whose image does not know the step", () => {
      expect(
        waitingOnOf({
          id: "ops:fill",
          status: "running",
          declared: undefined,
          roster,
          needsOldWritersGone: new Set(["ops:fill"]),
        }),
      ).toEqual([{ role: "worker", image: "3.20.1", release: "3.20.1", lastSeenAt: "t2" }]);
    });
  });

  describe("when the step does not wait or has settled", () => {
    it.each([
      { status: "pending", declared: { ...declared, needsOldWritersGone: false } },
      { status: "pending", declared: undefined },
      { status: "done", declared },
      { status: "not-needed", declared },
    ])("waits on nothing for %o", ({ status, declared: step }) => {
      expect(waitingOnOf({ id: "ops:fill", status, declared: step, roster })).toEqual([]);
    });
  });
});

import { describe, expect, it } from "vitest";

import { progressOf, viewDeclaredStep, viewRecordedStep, waitingOnOf } from "../step-view.ts";

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

describe("finishBy", () => {
  const declared = { id: "ops:fill", kind: "data", mode: "background", finishBy: "3.25.0" };
  const row = {
    id: "ops:fill",
    kind: "data",
    release: "3.23.0",
    mode: "background",
    status: "running",
    inferred: false,
    attempt: 1,
    last_error: null,
    report: null,
    run_id: null,
    started_at: null,
    finished_at: null,
    updated_at: null,
    owner: null,
    description: null,
    finish_by: "3.24.0",
  };

  describe("when the ledger row names the release a background step must finish by", () => {
    it("reads it from the row before the image's declaration", () => {
      expect(viewRecordedStep({ row, declared, roster: [] }).finishBy).toBe("3.24.0");
    });
  });

  describe("when only the image declares it", () => {
    it("reads it from the declaration, and null when neither names one", () => {
      expect(
        viewRecordedStep({ row: { ...row, finish_by: null }, declared, roster: [] }).finishBy,
      ).toBe("3.25.0");
      expect(
        viewDeclaredStep({ step: declared, imageRelease: "3.23.0", roster: [] }).finishBy,
      ).toBe("3.25.0");
      expect(
        viewRecordedStep({ row: { ...row, finish_by: null }, declared: undefined, roster: [] })
          .finishBy,
      ).toBeNull();
    });
  });
});

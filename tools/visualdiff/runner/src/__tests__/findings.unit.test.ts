import { describe, expect, it } from "vitest";
import { oneSidedFailures } from "../findings";
import type { CaptureMessage } from "../protocol";

const capture = (overrides: Partial<CaptureMessage>): CaptureMessage => ({
  type: "capture",
  kind: "flow",
  key: "automation-create",
  index: 3,
  label: "click Create automation",
  side: "base",
  url: "http://app/x",
  screenshot: "/shots/x.png",
  consoleErrors: [],
  failedRequests: [],
  notFound: false,
  error: "",
  durationMs: 10,
  ...overrides,
});

describe("Feature: Visual diff between two refs", () => {
  describe("given a step that succeeds on the base and throws on the candidate", () => {
    describe("when the runner reports that step", () => {
      /** @scenario A flow step that fails on one side is a finding */
      it("reports the one-sided failure and names the side it failed on", () => {
        const failures = oneSidedFailures({
          captures: [
            capture({ side: "base" }),
            capture({ side: "candidate", error: "click Create automation: timeout" }),
          ],
        });

        expect(failures).toEqual([
          {
            key: "automation-create",
            index: 3,
            label: "click Create automation",
            failedOn: "candidate",
            error: "click Create automation: timeout",
          },
        ]);
      });

      /** @scenario A flow step that fails on one side is a finding */
      it("does not report a step that fails on both sides", () => {
        const failures = oneSidedFailures({
          captures: [
            capture({ side: "base", error: "no such locator" }),
            capture({ side: "candidate", error: "no such locator" }),
          ],
        });

        expect(failures).toEqual([]);
      });

      it("does not confuse two steps of the same flow", () => {
        const failures = oneSidedFailures({
          captures: [
            capture({ index: 1, side: "base" }),
            capture({ index: 1, side: "candidate" }),
            capture({ index: 2, side: "base" }),
            capture({ index: 2, side: "candidate", error: "timeout" }),
          ],
        });

        expect(failures.map((failure) => failure.index)).toEqual([2]);
      });
    });
  });
});

import type { Logger } from "@langwatch/observability";
import { describe, expect, it, vi } from "vitest";

import { captureException } from "~/utils/posthogErrorCapture";
import { nurtureFireAndForget, priorNurtureCount } from "../nurtureSync";

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

function createLoggerSpy() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger & { error: ReturnType<typeof vi.fn> };
}

/** Lets a rejected promise's `.catch` run before the assertion. */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("nurtureFireAndForget", () => {
  describe("given a nurture call that resolves", () => {
    describe("when it is fired", () => {
      it("returns before the call settles, so the caller never waits on it", async () => {
        const logger = createLoggerSpy();
        let settle: (() => void) | undefined;
        const pending = new Promise<void>((resolve) => {
          settle = resolve;
        });

        const returned = nurtureFireAndForget({
          promise: pending,
          logger,
          projectId: "project-1",
          what: "identify user for first trace",
        });

        expect(returned).toBeUndefined();
        settle?.();
        await flushMicrotasks();
        expect(logger.error).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a nurture call that rejects", () => {
    describe("when it is fired", () => {
      it("swallows the rejection instead of surfacing it to the caller", async () => {
        const logger = createLoggerSpy();

        expect(() =>
          nurtureFireAndForget({
            promise: Promise.reject(new Error("customer.io is down")),
            logger,
            projectId: "project-1",
            what: "track evaluation_ran event",
          }),
        ).not.toThrow();

        await flushMicrotasks();
      });

      it("logs the failure against the project and reports it", async () => {
        const logger = createLoggerSpy();
        const error = new Error("customer.io is down");

        nurtureFireAndForget({
          promise: Promise.reject(error),
          logger,
          projectId: "project-1",
          what: "identify user for first simulation",
        });
        await flushMicrotasks();

        expect(logger.error).toHaveBeenCalledWith(
          { projectId: "project-1", error },
          "Failed to identify user for first simulation",
        );
        expect(captureException).toHaveBeenCalledWith(error);
      });
    });
  });
});

describe("priorNurtureCount", () => {
  describe("given the org-wide count already includes the run being handled", () => {
    describe("when the prior count is derived", () => {
      it("excludes the current one", () => {
        expect(priorNurtureCount(3)).toBe(2);
      });

      it("reads a count of one as the first, so the milestone fires", () => {
        expect(priorNurtureCount(1)).toBe(0);
      });
    });
  });

  describe("given a count that has not caught up with the fold", () => {
    describe("when the prior count is derived", () => {
      it("clamps at zero rather than going negative", () => {
        expect(priorNurtureCount(0)).toBe(0);
      });
    });
  });
});

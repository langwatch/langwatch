import { ResourceScope } from "@langwatch/kernel";
import { describe, expect, it, vi } from "vitest";
import { createWorkerTraceProductAnalytics } from "../worker-trace-product-analytics.composition.ts";

// Tests that the composition root builds a real sink and that it's flushed
// when the process gives resources back
// (modules/trace/specs/trace-product-analytics-worker-composition.feature)
describe("createWorkerTraceProductAnalytics", () => {
  describe("given the two variables this process now reads", () => {
    describe("when the sink is composed", () => {
      /** @scenario "A deployment that configured PostHog delivers the milestone" */
      it("answers the port Trace declares", () => {
        const analytics = createWorkerTraceProductAnalytics({
          config: { key: "phc_test", host: "https://eu.i.posthog.com" },
        });

        expect(typeof analytics.record).toBe("function");
      });

      /** @scenario "A deployment that configured no product analytics records nothing" */
      it("composes a sink on a deployment that named no key rather than none at all", () => {
        const analytics = createWorkerTraceProductAnalytics({ config: {} });

        expect(typeof analytics.record).toBe("function");
        expect(() =>
          analytics.record({ userId: "user-1", event: "first_trace_integrated" }),
        ).not.toThrow();
      });
    });
  });

  describe("given a resource scope", () => {
    describe("when the process gives its resources back", () => {
      /** @scenario "Pending events are flushed when the process shuts down" */
      it("owns the sink so the pending queue is flushed", async () => {
        const resources = new ResourceScope();
        const owned: string[] = [];
        vi.spyOn(resources, "own").mockImplementation((name: string) => {
          owned.push(name);
        });

        createWorkerTraceProductAnalytics({ config: { key: "phc_test" }, resources });

        expect(owned).toEqual(["worker product analytics"]);
      });
    });
  });
});

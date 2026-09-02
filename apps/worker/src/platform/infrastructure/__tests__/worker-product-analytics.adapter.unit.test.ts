import { describe, expect, it, vi } from "vitest";
import {
  WorkerPostHogProductAnalyticsAdapter,
  type ProductAnalyticsClient,
} from "../worker-product-analytics.adapter";

/**
 * Spec: packages/features/trace/specs/trace-product-analytics-worker-composition.feature
 *
 * A FROZEN-TWIN test against `platform/app/src/server/posthog.ts`. Every
 * assertion below is a literal read of what that module puts on the wire —
 * `distinctId` is the user id, the properties are the event's own with
 * `projectId` spread in after them, the key decides whether a client exists at
 * all, and shutdown flushes. None of it is derived from the application's
 * source, which would die the moment either file moves.
 */

type Capture = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
};

function fakeClient(): ProductAnalyticsClient & {
  captures: Capture[];
  shutdowns: number;
} {
  const captures: Capture[] = [];
  return {
    captures,
    shutdowns: 0,
    capture(input: Capture) {
      captures.push(input);
    },
    async shutdown() {
      this.shutdowns += 1;
    },
  };
}

function adapterWith(config: { key?: string; host?: string }) {
  const client = fakeClient();
  const built: Array<[string, { host: string | undefined }]> = [];
  const adapter = WorkerPostHogProductAnalyticsAdapter.createWithClientFactory({
    config,
    logger: { warn: vi.fn() } as never,
    createClient: (key, options) => {
      built.push([key, options]);
      return client;
    },
  });
  return { adapter, client, built };
}

const milestone = {
  userId: "user-1",
  event: "first_trace_integrated",
  properties: { sdk_language: "python", sdk_framework: "unknown" },
  projectId: "project-1",
};

describe("WorkerPostHogProductAnalyticsAdapter", () => {
  describe("given a deployment that named no PostHog key", () => {
    describe("when the first-trace milestone is recorded", () => {
      /** @scenario "A deployment that configured no product analytics records nothing" */
      it("builds no client and captures nothing", () => {
        const { adapter, client, built } = adapterWith({});

        adapter.record(milestone);

        expect(built).toEqual([]);
        expect(client.captures).toEqual([]);
      });

      /** @scenario "A deployment that configured no product analytics records nothing" */
      it("treats an empty key exactly as an absent one", () => {
        const { adapter, built } = adapterWith({ key: "" });

        adapter.record(milestone);

        expect(built).toEqual([]);
      });
    });
  });

  describe("given a deployment that named a PostHog key", () => {
    describe("when the first-trace milestone is recorded", () => {
      /** @scenario "A deployment that configured PostHog delivers the milestone" */
      it("captures the event under the name the funnel is built on", () => {
        const { adapter, client } = adapterWith({ key: "phc_test" });

        adapter.record(milestone);

        expect(client.captures.map((capture) => capture.event)).toEqual(["first_trace_integrated"]);
      });

      /** @scenario "The milestone is attributed to the person the browser knows" */
      it("captures against the org admin's user id as the distinct id", () => {
        const { adapter, client } = adapterWith({ key: "phc_test" });

        adapter.record(milestone);

        expect(client.captures[0]!.distinctId).toBe("user-1");
      });

      /** @scenario "The project rides along as a property" */
      it("spreads the project id in beside the event's own properties", () => {
        const { adapter, client } = adapterWith({ key: "phc_test" });

        adapter.record(milestone);

        expect(client.captures[0]!.properties).toEqual({
          sdk_language: "python",
          sdk_framework: "unknown",
          projectId: "project-1",
        });
      });

      /** @scenario "A milestone with no project carries no project property" */
      it("omits the project key entirely when the event names no project", () => {
        const { adapter, client } = adapterWith({ key: "phc_test" });

        adapter.record({ userId: "user-1", event: "first_trace_integrated" });

        expect(client.captures[0]!.properties).toEqual({});
        expect(Object.keys(client.captures[0]!.properties!)).not.toContain("projectId");
      });

      /** @scenario "A deployment that configured PostHog delivers the milestone" */
      it("builds the client once across repeated records", () => {
        const { adapter, built } = adapterWith({ key: "phc_test" });

        adapter.record(milestone);
        adapter.record(milestone);

        expect(built).toHaveLength(1);
      });
    });

    describe("when the deployment also named a host", () => {
      /** @scenario "The host is the deployment's own, never one invented here" */
      it("builds the client against that host", () => {
        const { adapter, built } = adapterWith({
          key: "phc_test",
          host: "https://eu.i.posthog.com",
        });

        adapter.record(milestone);

        expect(built).toEqual([["phc_test", { host: "https://eu.i.posthog.com" }]]);
      });
    });

    describe("when the deployment named no host", () => {
      /** @scenario "The host is the deployment's own, never one invented here" */
      it("passes the absent host through rather than substituting a default", () => {
        const { adapter, built } = adapterWith({ key: "phc_test" });

        adapter.record(milestone);

        expect(built).toEqual([["phc_test", { host: undefined }]]);
      });
    });
  });

  describe("given a capture client that throws", () => {
    describe("when the first-trace milestone is recorded", () => {
      /** @scenario "Recording never fails the trace that caused it" */
      it("swallows the failure so the ingestion path continues", () => {
        const warn = vi.fn();
        const adapter = WorkerPostHogProductAnalyticsAdapter.createWithClientFactory({
          config: { key: "phc_test" },
          logger: { warn } as never,
          createClient: () => ({
            capture() {
              throw new Error("posthog is unreachable");
            },
            async shutdown() {},
          }),
        });

        expect(() => adapter.record(milestone)).not.toThrow();
        expect(warn).toHaveBeenCalledWith(
          { productEvent: "first_trace_integrated", error: "posthog is unreachable" },
          "Could not record a product event; the onboarding funnel will undercount this project",
        );
      });

      /** @scenario "Recording never fails the trace that caused it" */
      it("does not log the customer's own event properties", () => {
        const warn = vi.fn();
        const adapter = WorkerPostHogProductAnalyticsAdapter.createWithClientFactory({
          config: { key: "phc_test" },
          logger: { warn } as never,
          createClient: () => ({
            capture() {
              throw new Error("posthog is unreachable");
            },
            async shutdown() {},
          }),
        });

        adapter.record(milestone);

        const logged = JSON.stringify(warn.mock.calls[0]![0]);
        expect(logged).not.toContain("user-1");
        expect(logged).not.toContain("python");
      });
    });
  });

  describe("given a process holding a capture client with queued events", () => {
    describe("when the process closes its resources", () => {
      /** @scenario "Pending events are flushed when the process shuts down" */
      it("shuts the client down so the queue is flushed", async () => {
        const { adapter, client } = adapterWith({ key: "phc_test" });
        adapter.record(milestone);

        await adapter.close();

        expect(client.shutdowns).toBe(1);
      });

      /** @scenario "Pending events are flushed when the process shuts down" */
      it("closes without a client when nothing was ever recorded", async () => {
        const { adapter, client } = adapterWith({ key: "phc_test" });

        await adapter.close();

        expect(client.shutdowns).toBe(0);
      });
    });
  });
});

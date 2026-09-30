/**
 * The chart's shutdownDrainSeconds reaches the process as
 * `SHUTDOWN_DRAIN_TIMEOUT_MS`, and both eventing roles hand it to the queue
 * as its drain timeout.
 */
import { parseProcessConfig } from "@langwatch/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storesOwner } from "../config-owner.ts";
import { PipelineParticipation } from "../pipeline-selection.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [storesOwner], environment }).stores;

const roles = [
  ["producing", PipelineParticipation.producer()],
  ["consuming", PipelineParticipation.consumer()],
] as const;

describe("queue drain budget", () => {
  /** @scenario "The queue drains for as long as the chart's drain value" */
  describe("given SHUTDOWN_DRAIN_TIMEOUT_MS names a drain budget", () => {
    const config = read({ SHUTDOWN_DRAIN_TIMEOUT_MS: "120000" });

    it("reads it on the stores owner", () => {
      expect(config.shutdownDrainTimeoutMs).toBe(120_000);
    });

    for (const [label, pipelines] of roles) {
      describe(`when a ${label} role configures its eventing`, () => {
        it("gives the queue that drain timeout", () => {
          const eventing = pipelines.configure({
            defaultRetentionDays: config.defaultRetentionDays,
            queueDrainTimeoutMs: config.shutdownDrainTimeoutMs,
          });
          expect(eventing.groupQueue?.policy?.drainTimeoutMs).toBe(120_000);
        });
      });
    }
  });

  describe("given no drain budget is named", () => {
    const config = read({ SHUTDOWN_DRAIN_TIMEOUT_MS: "" });

    it("leaves the setting unset", () => {
      expect(config.shutdownDrainTimeoutMs).toBeUndefined();
    });

    for (const [label, pipelines] of roles) {
      describe(`when a ${label} role configures its eventing`, () => {
        it("keeps the queue's own default", () => {
          const eventing = pipelines.configure({
            defaultRetentionDays: config.defaultRetentionDays,
            queueDrainTimeoutMs: config.shutdownDrainTimeoutMs,
          });
          expect(eventing.groupQueue?.policy).toBeUndefined();
        });
      });
    }
  });

  /** @scenario "A malformed drain override is reported and falls back, never fatal" */
  describe("given a drain budget that is not a positive number", () => {
    let reported: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      reported.mockRestore();
    });

    describe.each(["0", "-5", "abc", "1.5"])("when it is %s", (value) => {
      it("boots with the queue's own default", () => {
        expect(read({ SHUTDOWN_DRAIN_TIMEOUT_MS: value }).shutdownDrainTimeoutMs).toBeUndefined();
      });

      it("reports the variable and the bad value", () => {
        read({ SHUTDOWN_DRAIN_TIMEOUT_MS: value });
        expect(String(reported.mock.calls[0]?.[0])).toContain(`SHUTDOWN_DRAIN_TIMEOUT_MS`);
        expect(String(reported.mock.calls[0]?.[0])).toContain(`"${value}"`);
      });
    });
  });
});

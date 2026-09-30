import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";
import { processShutdownDeadlineMs } from "../shutdown-deadline.ts";

/** Resolves the deadline the way ProcessServer.create does, from the parsed env. */
const deadlineFor = (environment: Record<string, string | undefined>) => {
  const config = parseProcessConfig({ owners: processConfig([], "worker"), environment });
  return processShutdownDeadlineMs({
    deadlineMs: config.process.shutdownDeadlineMs,
    queueDrainMs: config.stores.shutdownDrainTimeoutMs,
  });
};

describe("process shutdown deadline", () => {
  /** @scenario "The process deadline defaults above the queue drain" */
  describe("given a drain budget and no PROCESS_SHUTDOWN_DEADLINE_MS", () => {
    describe("when the deadline is resolved", () => {
      it("is the drain plus twenty seconds of close slack", () => {
        expect(deadlineFor({ SHUTDOWN_DRAIN_TIMEOUT_MS: "120000" })).toBe(140_000);
      });
    });
  });

  describe("given an explicit PROCESS_SHUTDOWN_DEADLINE_MS", () => {
    describe("when the deadline is resolved", () => {
      it("uses it over the derived one", () => {
        expect(
          deadlineFor({
            SHUTDOWN_DRAIN_TIMEOUT_MS: "120000",
            PROCESS_SHUTDOWN_DEADLINE_MS: "150000",
          }),
        ).toBe(150_000);
      });
    });
  });

  describe("given neither value", () => {
    describe("when the deadline is resolved", () => {
      it("keeps the default above the queue's own drain", () => {
        expect(deadlineFor({})).toBe(60_000);
      });
    });
  });
});

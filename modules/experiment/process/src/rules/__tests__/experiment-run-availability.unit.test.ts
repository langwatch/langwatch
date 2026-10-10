/**
 * @vitest-environment node
 * What a process refuses of a run without Redis or a public address.
 */
import { describe, expect, it } from "vitest";

import { runRefusalsOf } from "../experiment-run-availability.rules.ts";

const PROCESS = "langwatch-test";

describe("runRefusalsOf", () => {
  describe("given a process with no Redis", () => {
    /** @scenario "A process without Redis refuses to start a run by name" */
    it("refuses to start a run, naming the progress store and the process", () => {
      const refusals = runRefusalsOf({
        sharedStore: false,
        publicBaseUrl: "https://app.test",
        processName: PROCESS,
      });

      expect(refusals.start).toEqual({
        process: PROCESS,
        capability: expect.stringMatching(/^progress store/),
      });
    });

    /** @scenario "A read with no progress store refuses by name" */
    it("refuses to read a run by name", () => {
      const refusals = runRefusalsOf({
        sharedStore: false,
        publicBaseUrl: "https://app.test",
        processName: PROCESS,
      });

      expect(refusals.read).toEqual({ capability: "experiment run progress store" });
    });
  });

  describe("given a process with Redis but no public address", () => {
    /** @scenario "A process without a public address refuses to start a run but still answers polls" */
    it("refuses to start a run and reads one", () => {
      const refusals = runRefusalsOf({
        sharedStore: true,
        publicBaseUrl: undefined,
        processName: PROCESS,
      });

      expect(refusals.start).toEqual({
        process: PROCESS,
        capability: expect.stringMatching(/^public address/),
      });
      expect(refusals.read).toBeUndefined();
    });
  });

  describe("given a process with Redis and a public address", () => {
    /** @scenario "Polling a run does not need the run loop that starts one" */
    it("refuses nothing", () => {
      const refusals = runRefusalsOf({
        sharedStore: true,
        publicBaseUrl: "https://app.test",
        processName: PROCESS,
      });

      expect(refusals).toEqual({});
    });
  });
});

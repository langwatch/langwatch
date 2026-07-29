import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { getRunStatePollInterval } from "../run-state-polling";

describe("getRunStatePollInterval()", () => {
  describe("given a run in a terminal status", () => {
    const terminalStatuses = [
      ScenarioRunStatus.SUCCESS,
      ScenarioRunStatus.FAILED,
      ScenarioRunStatus.ERROR,
      ScenarioRunStatus.CANCELLED,
    ];

    describe("when the event stream is connected", () => {
      it.each(terminalStatuses)("stops polling for %s", (status) => {
        expect(
          getRunStatePollInterval({ status, sseConnected: true }),
        ).toBe(false);
      });
    });

    describe("when the event stream is disconnected", () => {
      it.each(terminalStatuses)("still stops polling for %s", (status) => {
        expect(
          getRunStatePollInterval({ status, sseConnected: false }),
        ).toBe(false);
      });
    });
  });

  describe("given a run that is still executing", () => {
    const activeStatuses = [
      ScenarioRunStatus.QUEUED,
      ScenarioRunStatus.PENDING,
      ScenarioRunStatus.IN_PROGRESS,
      ScenarioRunStatus.RUNNING,
    ];

    describe("when the event stream is disconnected", () => {
      it.each(activeStatuses)("polls fast for %s", (status) => {
        expect(
          getRunStatePollInterval({ status, sseConnected: false }),
        ).toBe(3000);
      });
    });

    describe("when the event stream is connected", () => {
      it.each(activeStatuses)(
        "falls back to slow safety-net polling for %s",
        (status) => {
          expect(
            getRunStatePollInterval({ status, sseConnected: true }),
          ).toBe(15_000);
        },
      );
    });
  });

  describe("given the run has not loaded yet", () => {
    describe("when the event stream is disconnected", () => {
      it("polls fast so a just-queued run appears promptly", () => {
        expect(
          getRunStatePollInterval({ status: undefined, sseConnected: false }),
        ).toBe(3000);
      });
    });

    describe("when the event stream is connected", () => {
      it("polls slowly as a safety net", () => {
        expect(
          getRunStatePollInterval({ status: undefined, sseConnected: true }),
        ).toBe(15_000);
      });
    });
  });

  describe("given a stalled run", () => {
    describe("when the event stream is connected", () => {
      it("stops polling and relies on revival events", () => {
        expect(
          getRunStatePollInterval({
            status: ScenarioRunStatus.STALLED,
            sseConnected: true,
          }),
        ).toBe(false);
      });
    });

    describe("when the event stream is disconnected", () => {
      it("polls slowly to catch a revival", () => {
        expect(
          getRunStatePollInterval({
            status: ScenarioRunStatus.STALLED,
            sseConnected: false,
          }),
        ).toBe(15_000);
      });
    });
  });
});

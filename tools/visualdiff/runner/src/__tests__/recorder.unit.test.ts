import { describe, expect, it } from "vitest";
import { StepRecorder } from "../recorder";
import { contextOptions } from "../capture";

describe("Feature: Visual diff between two refs", () => {
  describe("given a step that logs a console error and gets a 500", () => {
    describe("when the runner reports that step", () => {
      /** @scenario Console errors and failed requests are recorded per step */
      it("attaches both to that step and not to the next one", () => {
        const recorder = new StepRecorder();
        recorder.consoleError("TypeError: cannot read properties of undefined");
        recorder.failedRequest("500 GET /api/automations");

        const first = recorder.drain();
        const second = recorder.drain();

        expect(first.consoleErrors).toEqual(["TypeError: cannot read properties of undefined"]);
        expect(first.failedRequests).toEqual(["500 GET /api/automations"]);
        expect(second).toEqual({ consoleErrors: [], failedRequests: [] });
      });

      /** @scenario Console errors and failed requests are recorded per step */
      it("collapses whitespace so a stack trace stays one readable line", () => {
        const recorder = new StepRecorder();
        recorder.consoleError("Error: boom\n    at render (app.tsx:1)\n    at mount (app.tsx:2)");

        expect(recorder.drain().consoleErrors).toEqual([
          "Error: boom at render (app.tsx:1) at mount (app.tsx:2)",
        ]);
      });
    });
  });

  describe("given a run asking for a 390x844 viewport", () => {
    describe("when the runner opens its browser contexts", () => {
      /** @scenario The viewport is configurable */
      it("uses that viewport, with the same colour scheme and motion on both sides", () => {
        const options = contextOptions({ viewport: { width: 390, height: 844 } });

        expect(options.viewport).toEqual({ width: 390, height: 844 });
        expect(options.colorScheme).toBe("light");
        expect(options.reducedMotion).toBe("reduce");
        expect(options.deviceScaleFactor).toBe(1);
      });

      /** @scenario The viewport is configurable */
      it("carries a storage state only when the run has one", () => {
        expect(contextOptions({ viewport: { width: 1440, height: 900 } })).not.toHaveProperty(
          "storageState",
        );
        expect(
          contextOptions({
            viewport: { width: 1440, height: 900 },
            storageState: "/run/storage.json",
          }),
        ).toHaveProperty("storageState", "/run/storage.json");
      });
    });
  });
});

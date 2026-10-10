import { afterAll, describe, expect, it } from "vitest";

import { upcastDrainWindowRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { usage: { layoutVersion: 0, roles: { process: {} } } },
  files: {
    "packages/upgrade/releases/3.20.0.json": "{}",
    "packages/upgrade/releases/3.20.1.json": "{}",
    "packages/upgrade/releases/lts-floor.json": "{}",
  },
});

afterAll(() => workspace.cleanup());

const PIPELINE = "modules/usage/process/src/eventing/usage.pipeline.ts";

function upcasts(drain) {
  return `definePipeline({ name: "usage" }).withUpcasts({ events: [], drain: ${drain} });`;
}

function report(code, filename = PIPELINE) {
  return runRule(upcastDrainWindowRule, { code, cwd: workspace.cwd, filename });
}

function ids(code, filename) {
  return report(code, filename).map((entry) => entry.messageId);
}

describe("given an upcast drain in production source", () => {
  describe("when its removeAfter release has been cut", () => {
    /** @scenario "A drain past its release is reported" */
    it("reports it and names both releases", () => {
      const found = report(upcasts('{ pipeline: "usage", removeAfter: "3.20.1" }'));

      expect(found.map((entry) => entry.messageId)).toEqual(["drainPastWindow"]);
      expect(found[0].message).toContain("3.20.1");
    });
  });

  describe("when its removeAfter release is still to come", () => {
    /** @scenario "A drain inside its release is left alone" */
    it("reports nothing", () => {
      expect(ids(upcasts('{ pipeline: "usage", removeAfter: "3.21.0" }'))).toEqual([]);
    });
  });

  describe("when it declares no removeAfter release", () => {
    /** @scenario "A drain without a release is reported" */
    it("reports the missing window", () => {
      expect(ids(upcasts('{ pipeline: "usage" }'))).toEqual(["drainWithoutWindow"]);
    });
  });

  describe("when the upcasts declare no drain", () => {
    /** @scenario "Upcasts without a drain are left alone" */
    it("reports nothing", () => {
      expect(ids('definePipeline({ name: "usage" }).withUpcasts({ events: [] });')).toEqual([]);
    });
  });
});

describe("given an upcast drain in a test file", () => {
  describe("when its window has closed", () => {
    it("reports nothing", () => {
      const test = "modules/usage/process/src/eventing/__tests__/usage.pipeline.unit.test.ts";

      expect(ids(upcasts('{ pipeline: "usage", removeAfter: "3.20.0" }'), test)).toEqual([]);
    });
  });
});

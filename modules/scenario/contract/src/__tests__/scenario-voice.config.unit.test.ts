import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { scenarioConfig } from "../scenario.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "scenario", config: scenarioConfig }], environment })
    .scenario;

describe("scenario's voice configuration", () => {
  describe("given no voice variables set", () => {
    /** @scenario "The voice worker reads its infrastructure environment variables" */
    it("leaves voice worker only off, the tunnel on and no public origin", () => {
      expect(read({})).toMatchObject({
        voiceWorkerOnly: false,
        voiceTunnel: true,
        voicePublicBaseUrl: undefined,
      });
    });
  });

  describe("given VOICE_WORKER_ONLY values", () => {
    /** @scenario "The voice worker reads its infrastructure environment variables" */
    it("turns on only for the literal true, case-insensitively", () => {
      expect(read({ VOICE_WORKER_ONLY: "TRUE" }).voiceWorkerOnly).toBe(true);
      expect(read({ VOICE_WORKER_ONLY: "1" }).voiceWorkerOnly).toBe(false);
    });
  });

  describe("given VOICE_TUNNEL values", () => {
    /** @scenario "The voice worker reads its infrastructure environment variables" */
    it("turns the tunnel off only for the literal false", () => {
      expect(read({ VOICE_TUNNEL: "false" }).voiceTunnel).toBe(false);
      expect(read({ VOICE_TUNNEL: "0" }).voiceTunnel).toBe(true);
    });
  });

  describe("given the worker's runtime class and slot settings", () => {
    /** @scenario A worker only admits runtime classes it consumes */
    it("defaults to every class and today's concurrency, and refuses unknown names", () => {
      expect(read({})).toMatchObject({
        consumedResourceClasses: ["light", "voice"],
        slotBudget: 3,
      });
      expect(
        read({ SCENARIO_CONSUMED_RESOURCE_CLASSES: " voice ", SCENARIO_SLOT_BUDGET: "5" }),
      ).toMatchObject({ consumedResourceClasses: ["voice"], slotBudget: 5 });
      expect(() => read({ SCENARIO_CONSUMED_RESOURCE_CLASSES: "heavy" })).toThrow(
        /unknown runtime class/,
      );
      expect(() => read({ SCENARIO_SLOT_BUDGET: "0" })).toThrow(/positive integer/);
    });
  });
});

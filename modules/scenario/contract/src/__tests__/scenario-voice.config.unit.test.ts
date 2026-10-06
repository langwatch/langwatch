import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { isVoiceTunnelEnabled, scenarioConfig } from "../scenario.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "scenario", config: scenarioConfig }], environment })
    .scenario;

describe("scenario's voice configuration", () => {
  describe("given no voice variables set", () => {
    /** @scenario "The voice worker reads its infrastructure environment variables" */
    it("leaves voice worker only off, the tunnel unchosen and no public origin", () => {
      expect(read({})).toMatchObject({
        voiceWorkerOnly: false,
        voiceTunnel: undefined,
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
    it("reads only the literal true or false, case-insensitively", () => {
      expect(read({ VOICE_TUNNEL: "false" }).voiceTunnel).toBe(false);
      expect(read({ VOICE_TUNNEL: " TRUE " }).voiceTunnel).toBe(true);
      expect(read({ VOICE_TUNNEL: "0" }).voiceTunnel).toBeUndefined();
    });
  });

  describe("given the quick tunnel's default", () => {
    const enabled = (
      deployment: Partial<Parameters<typeof isVoiceTunnelEnabled>[0]> & { environment?: string },
    ) =>
      isVoiceTunnelEnabled({
        voiceTunnel: void 0,
        isSaas: false,
        nodeEnvironment: deployment.environment,
        ...deployment,
      });

    /** @scenario "A self-hosted production worker opens no quick tunnel unless enabled" */
    it("is off for a self-hosted production install and on for the hosted product and development", () => {
      expect(enabled({ environment: "production" })).toBe(false);
      expect(enabled({ environment: "production", isSaas: true })).toBe(true);
      expect(enabled({ environment: "development" })).toBe(true);
      expect(enabled({})).toBe(true);
    });

    /** @scenario "A self-hosted production worker opens no quick tunnel unless enabled" */
    it("follows an explicit VOICE_TUNNEL in every deployment", () => {
      expect(enabled({ environment: "production", voiceTunnel: true })).toBe(true);
      expect(enabled({ environment: "development", voiceTunnel: false })).toBe(false);
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

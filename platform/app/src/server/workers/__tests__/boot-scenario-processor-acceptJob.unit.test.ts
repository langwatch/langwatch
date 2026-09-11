/**
 * @vitest-environment node
 *
 * Pins the `acceptJob` wiring `bootScenarioProcessor` hands to
 * `ScenarioExecutionPool`. `execution-pool-voice-filter.unit.test.ts` already
 * covers `isVoiceJob`/`isNotVoiceJob` and the pool's admission behavior in
 * isolation — this test covers only the CALL SITE: does startWorkers.ts
 * actually pick the right predicate for `voiceWorkerOnly` true vs.
 * false/absent?
 *
 * The regression this guards: a one-sided `...(voiceWorkerOnly ? {
 * acceptJob: isVoiceJob } : {})` leaves an ordinary worker's pool with NO
 * `acceptJob` override, so it falls back to accepting everything — including
 * voice jobs. With 10-20 ordinary replicas and one voice worker, a voice job
 * then lands almost every time on a pod that never boots the Twilio media
 * listener, and the call has nowhere to send audio. Reverting the call site
 * to that one-sided form must fail this test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExecutionJobData } from "../../scenarios/execution/execution-pool";
import {
  isNotVoiceJob,
  isVoiceJob,
} from "../../scenarios/execution/voice-worker-only";

const capturedPoolOptions: Array<{ acceptJob: unknown }> = [];

vi.mock("~/server/app-layer/presets", () => ({
  getScenarioExecutionPool: vi.fn(() => ({ set: vi.fn() })),
}));

vi.mock("~/server/scenarios/execution/execution-pool", () => ({
  ScenarioExecutionPool: class {
    constructor(options: { acceptJob: unknown }) {
      capturedPoolOptions.push(options);
    }
  },
}));

vi.mock("~/server/scenarios/scenario.processor", () => ({
  startScenarioProcessor: vi.fn(async () => undefined),
}));

const voiceJob = { target: { type: "voice" } } as unknown as ExecutionJobData;
const textJob = { target: { type: "http" } } as unknown as ExecutionJobData;

describe("bootScenarioProcessor", () => {
  afterEach(() => {
    capturedPoolOptions.length = 0;
    vi.clearAllMocks();
  });

  describe("given voiceWorkerOnly is false", () => {
    it("wires the pool to accept only non-voice jobs", async () => {
      const { bootScenarioProcessor } = await import("../startWorkers");

      await bootScenarioProcessor([], { voiceWorkerOnly: false });

      expect(capturedPoolOptions).toHaveLength(1);
      const acceptJob = capturedPoolOptions[0]!.acceptJob as (
        job: ExecutionJobData,
      ) => boolean;
      expect(acceptJob).toBe(isNotVoiceJob);
      expect(acceptJob(textJob)).toBe(true);
      expect(acceptJob(voiceJob)).toBe(false);
    });
  });

  describe("given voiceWorkerOnly is omitted", () => {
    it("still wires the pool to accept only non-voice jobs", async () => {
      const { bootScenarioProcessor } = await import("../startWorkers");

      await bootScenarioProcessor([]);

      expect(capturedPoolOptions).toHaveLength(1);
      const acceptJob = capturedPoolOptions[0]!.acceptJob as (
        job: ExecutionJobData,
      ) => boolean;
      expect(acceptJob).toBe(isNotVoiceJob);
      expect(acceptJob(voiceJob)).toBe(false);
    });
  });

  describe("given voiceWorkerOnly is true", () => {
    it("wires the pool to accept only voice jobs", async () => {
      const { bootScenarioProcessor } = await import("../startWorkers");

      await bootScenarioProcessor([], { voiceWorkerOnly: true });

      expect(capturedPoolOptions).toHaveLength(1);
      const acceptJob = capturedPoolOptions[0]!.acceptJob as (
        job: ExecutionJobData,
      ) => boolean;
      expect(acceptJob).toBe(isVoiceJob);
      expect(acceptJob(voiceJob)).toBe(true);
      expect(acceptJob(textJob)).toBe(false);
    });
  });
});

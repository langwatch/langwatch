import { describe, expect, it } from "vitest";
import {
  callReachedLimit,
  VOICE_CALL_MAX_SECONDS_CEILING,
  VOICE_CALL_MAX_SECONDS_DEFAULT,
  VOICE_RUNS_MAX_CONCURRENT_DEFAULT,
  voiceCallMaxSeconds,
  voiceRunsMaxConcurrent,
} from "../voice-limits";

describe("voiceCallMaxSeconds", () => {
  describe("given the call time limit env vars", () => {
    describe("when the env var is unset", () => {
      it("returns the default", () => {
        expect(voiceCallMaxSeconds({} as NodeJS.ProcessEnv)).toBe(
          VOICE_CALL_MAX_SECONDS_DEFAULT,
        );
      });
    });

    describe("when the env var is a positive integer", () => {
      it("returns it", () => {
        expect(
          voiceCallMaxSeconds({
            VOICE_CALL_MAX_SECONDS: "90",
          } as NodeJS.ProcessEnv),
        ).toBe(90);
      });
    });

    describe("when the env var is invalid", () => {
      it("falls back to the default", () => {
        for (const raw of ["", "0", "-5", "abc", "0.5", "1.9"]) {
          expect(
            voiceCallMaxSeconds({
              VOICE_CALL_MAX_SECONDS: raw,
            } as NodeJS.ProcessEnv),
          ).toBe(VOICE_CALL_MAX_SECONDS_DEFAULT);
        }
      });
    });

    describe("when the env var exceeds the setTimeout ceiling", () => {
      it("clamps to the ceiling", () => {
        expect(
          voiceCallMaxSeconds({
            VOICE_CALL_MAX_SECONDS: "2147484",
          } as NodeJS.ProcessEnv),
        ).toBe(VOICE_CALL_MAX_SECONDS_CEILING);
      });
    });
  });
});

describe("voiceRunsMaxConcurrent", () => {
  describe("given the env is unset", () => {
    it("defaults to 2", () => {
      expect(voiceRunsMaxConcurrent({} as NodeJS.ProcessEnv)).toBe(
        VOICE_RUNS_MAX_CONCURRENT_DEFAULT,
      );
    });
  });

  describe("given a valid override", () => {
    it("honours it", () => {
      expect(
        voiceRunsMaxConcurrent({
          VOICE_RUNS_MAX_CONCURRENT: "4",
        } as NodeJS.ProcessEnv),
      ).toBe(4);
    });
  });
});

describe("callReachedLimit", () => {
  describe("given the configured maximum call duration", () => {
    it("is off one millisecond under the limit and on from the limit itself", () => {
      const maxCallSeconds = 300;

      expect(
        callReachedLimit({ durationMs: 300_000 - 1, maxCallSeconds }),
      ).toBe(false);
      expect(callReachedLimit({ durationMs: 300_000, maxCallSeconds })).toBe(
        true,
      );
      expect(
        callReachedLimit({ durationMs: 300_000 + 4_321, maxCallSeconds }),
      ).toBe(true);
    });

    it("follows the configured limit rather than the default", () => {
      expect(callReachedLimit({ durationMs: 60_000, maxCallSeconds: 60 })).toBe(
        true,
      );
      expect(
        callReachedLimit({ durationMs: 60_000, maxCallSeconds: 300 }),
      ).toBe(false);
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  VOICE_CALL_MAX_SECONDS_DEFAULT,
  VOICE_RUNS_MAX_CONCURRENT_DEFAULT,
  voiceCallMaxSeconds,
  voiceRunsMaxConcurrent,
} from "../voice-limits";

describe("voiceCallMaxSeconds", () => {
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
      for (const raw of ["", "0", "-5", "abc"]) {
        expect(
          voiceCallMaxSeconds({
            VOICE_CALL_MAX_SECONDS: raw,
          } as NodeJS.ProcessEnv),
        ).toBe(VOICE_CALL_MAX_SECONDS_DEFAULT);
      }
    });
  });
});

describe("voiceRunsMaxConcurrent", () => {
  it("defaults to 2 and honours a valid override", () => {
    expect(voiceRunsMaxConcurrent({} as NodeJS.ProcessEnv)).toBe(
      VOICE_RUNS_MAX_CONCURRENT_DEFAULT,
    );
    expect(
      voiceRunsMaxConcurrent({
        VOICE_RUNS_MAX_CONCURRENT: "4",
      } as NodeJS.ProcessEnv),
    ).toBe(4);
  });
});

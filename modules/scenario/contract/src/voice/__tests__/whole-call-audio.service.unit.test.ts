/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it, vi } from "vitest";
import {
  ELEVENLABS_CONVERSATION_ID_ATTR,
  resolveWholeCallAudio,
  TWILIO_CALL_SID_ATTR,
  type WholeCallAudioInfrastructure,
} from "../whole-call-audio.service";

/** A fake span reader: the run's trace ids, and the span attribute maps of
 *  each, keyed by trace id. Nothing touches ClickHouse. */
function fakeInfrastructure({
  traceIds = ["trace_0"],
  spansByTrace = {},
}: {
  traceIds?: string[];
  spansByTrace?: Record<string, Array<Record<string, unknown>>>;
}): WholeCallAudioInfrastructure {
  return {
    loadRunTraceIds: vi.fn(async () => traceIds),
    readSpanAttributes: vi.fn(
      async ({ traceId }) => spansByTrace[traceId] ?? [],
    ),
  };
}

describe("resolveWholeCallAudio", () => {
  describe("given a run whose spans carry a Twilio call sid", () => {
    describe("when the whole-call audio is resolved", () => {
      /** @scenario "A phone run's whole-call audio is resolved from the call's own trace" */
      it("resolves the twilio handle from the call's own trace", async () => {
        const infrastructure = fakeInfrastructure({
          traceIds: ["trace_0"],
          spansByTrace: {
            trace_0: [
              { "some.other": "x" },
              { [TWILIO_CALL_SID_ATTR]: "CA123" },
            ],
          },
        });

        const handle = await resolveWholeCallAudio({
          projectId: "project_1",
          scenarioRunId: "run_1",
          infrastructure,
        });

        expect(handle).toEqual({ kind: "twilio", callSid: "CA123" });
      });
    });
  });

  describe("given a run whose spans carry an ElevenLabs conversation id", () => {
    describe("when the whole-call audio is resolved", () => {
      it("resolves the elevenlabs handle", async () => {
        const infrastructure = fakeInfrastructure({
          spansByTrace: {
            trace_0: [{ [ELEVENLABS_CONVERSATION_ID_ATTR]: "conv_9" }],
          },
        });

        const handle = await resolveWholeCallAudio({
          projectId: "project_1",
          scenarioRunId: "run_1",
          infrastructure,
        });

        expect(handle).toEqual({
          kind: "elevenlabs",
          conversationId: "conv_9",
        });
      });
    });
  });

  describe("given a run whose spans carry no call handle", () => {
    describe("when the whole-call audio is resolved", () => {
      /** @scenario "A run against a voice agent with no call handle has no whole-call audio" */
      it("resolves to null", async () => {
        const infrastructure = fakeInfrastructure({
          spansByTrace: { trace_0: [{ "gen_ai.request.model": "gpt" }] },
        });

        const handle = await resolveWholeCallAudio({
          projectId: "project_1",
          scenarioRunId: "run_1",
          infrastructure,
        });

        expect(handle).toBeNull();
      });
    });
  });

  describe("given the handle is on a later trace of the run", () => {
    describe("when the whole-call audio is resolved", () => {
      it("scans every trace of the run until it finds one", async () => {
        const infrastructure = fakeInfrastructure({
          traceIds: ["trace_0", "trace_1"],
          spansByTrace: {
            trace_0: [{ "some.other": "x" }],
            trace_1: [{ [TWILIO_CALL_SID_ATTR]: "CA777" }],
          },
        });

        const handle = await resolveWholeCallAudio({
          projectId: "project_1",
          scenarioRunId: "run_1",
          infrastructure,
        });

        expect(handle).toEqual({ kind: "twilio", callSid: "CA777" });
      });
    });
  });

  describe("given an empty-string attribute", () => {
    describe("when the whole-call audio is resolved", () => {
      it("does not treat it as a usable handle", async () => {
        const infrastructure = fakeInfrastructure({
          spansByTrace: { trace_0: [{ [TWILIO_CALL_SID_ATTR]: "" }] },
        });

        const handle = await resolveWholeCallAudio({
          projectId: "project_1",
          scenarioRunId: "run_1",
          infrastructure,
        });

        expect(handle).toBeNull();
      });
    });
  });
});

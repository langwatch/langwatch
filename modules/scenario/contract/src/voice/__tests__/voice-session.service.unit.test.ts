/**
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { CallRecord } from "../call-record";
import {
  phoneTransport,
  VoicePhoneTransportUnavailableError,
} from "../transports/phone.transport";
import {
  authorizeRecordingPlayback,
  finishVoiceSession,
  mintVoiceSession,
  VoiceAgentRowNotFoundError,
  VoiceConversationMismatchError,
  VoiceKeyMissingError,
  VoiceRecordingKeyMissingError,
  VoiceRecordingUnavailableError,
  VoiceScenarioNotFoundError,
  type VoiceSessionInfrastructure,
} from "../voice-session.service";
import type { VoiceSessionTokenPayload } from "../voice-session-token";
import type {
  VoiceTransportCredential,
  VoiceTransportRunner,
} from "../voice-transport.registry";

const CREDENTIAL: VoiceTransportCredential = {
  kind: "elevenlabs",
  apiKey: "sk-secret-123",
  baseUrl: "https://api.elevenlabs.io",
};

function fakeRunner(
  over: Partial<VoiceTransportRunner> = {},
): VoiceTransportRunner {
  return {
    missingKeyMessage: "No ElevenLabs key in this project",
    createAgentAdapter: () => ({}) as never,
    mintSession: vi.fn(async () => ({ signedUrl: "wss://signed.example/abc" })),
    fetchCallRecord: vi.fn(async () => null),
    endCall: vi.fn(async () => {}),
    ...over,
  };
}

function fakePorts({
  runner,
  over = {},
}: {
  runner: VoiceTransportRunner;
  over?: Partial<VoiceSessionInfrastructure>;
}): VoiceSessionInfrastructure {
  return {
    resolveCredential: vi.fn(async () => CREDENTIAL),
    resolveVoiceAgentRow: vi.fn(async () => ({
      id: "agent_row",
      agentExternalId: "agent_xyz",
    })),
    hasVoiceAgentForExternalId: vi.fn(async () => false),
    findExistingRun: vi.fn(async () => null),
    createVoiceAgent: vi.fn(async () => ({ id: "agent_created" })),
    // One deterministic trace id per turn, so a caller/assertion can read them
    // back off the writeCallRun call.
    recordCallTraces: vi.fn(async ({ record }: { record: CallRecord }) => ({
      turnTraceIds: record.turns.map((_, index) => `trace_${index}`),
    })),
    writeCallRun: vi.fn(async () => {}),
    // A scenario call resolves its set here; a drawer call never reaches it.
    // Individual tests override to assert it is or is not called.
    resolveScenarioSet: vi.fn(async () => ({ scenarioSetId: "set_x" })),
    audioProxyUrl: ({ conversationId, projectId }) =>
      `/api/voice/session/${conversationId}/audio?projectId=${projectId}`,
    // A fake signer that round-trips the payload so tests can read the claims.
    signSessionToken: (payload) => JSON.stringify(payload),
    now: () => 1000,
    newSessionId: () => "sess_generated",
    registry: { elevenlabs_convai: runner, phone: phoneTransport },
    ...over,
  };
}

const TOKEN: VoiceSessionTokenPayload = {
  sessionId: "sess_1",
  projectId: "p1",
  agentId: null,
  agentExternalId: "agent_xyz",
  transport: "elevenlabs_convai",
  exp: 9_999_999_999_999,
};

const FINISH_BASE = {
  token: TOKEN,
  projectId: "p1",
  transcript: [{ role: "caller" as const, text: "hi" }],
  startedAt: 1000,
  endedAt: 5000,
  isCutAtLimit: false,
  conversationId: "conv_1",
};

describe("mintVoiceSession", () => {
  describe("given the voice session ports", () => {
    describe("when the project has a key and the row is a voice agent", () => {
      /** @scenario "Session mint returns only the signed URL, the conversation id and the max duration" */
      it("returns the signed URL, a signed session token and the max duration — never the key", async () => {
        const ports = fakePorts({ runner: fakeRunner() });
        const result = await mintVoiceSession({
          ports,
          projectId: "p1",
          transport: "elevenlabs_convai",
          agentId: "agent_xyz",
          agentRowId: "agent_row",
          maxDurationSeconds: 300,
        });

        expect(result.transport).toBe("elevenlabs_convai");
        expect(result.maxDurationSeconds).toBe(300);
        expect(result.connect).toEqual({
          signedUrl: "wss://signed.example/abc",
        });
        // The token binds the call to its project and vendor agent.
        const payload = JSON.parse(result.sessionToken);
        expect(payload).toMatchObject({
          projectId: "p1",
          agentExternalId: "agent_xyz",
          agentId: "agent_row",
          transport: "elevenlabs_convai",
        });
        expect(JSON.stringify(result)).not.toContain(CREDENTIAL.apiKey);
      });

      it("mints against the vendor id from the stored row, ignoring what a body would have named", async () => {
        const resolveVoiceAgentRow = vi.fn(async () => ({
          id: "agent_row",
          agentExternalId: "agent_from_row",
        }));
        const mintSpy = vi.fn(async () => ({
          signedUrl: "wss://signed.example/abc",
        }));
        const ports = fakePorts({
          runner: fakeRunner({ mintSession: mintSpy }),
          over: { resolveVoiceAgentRow },
        });

        const result = await mintVoiceSession({
          ports,
          projectId: "p1",
          transport: "elevenlabs_convai",
          // A client-supplied agentId that must be ignored once a row exists.
          agentId: "agent_from_body",
          agentRowId: "agent_row",
          maxDurationSeconds: 300,
        });

        expect(mintSpy).toHaveBeenCalledWith(
          expect.objectContaining({ agentId: "agent_from_row" }),
        );
        expect(JSON.parse(result.sessionToken)).toMatchObject({
          agentExternalId: "agent_from_row",
          agentId: "agent_row",
        });
      });
    });

    describe("when there is no saved agent row yet (an unsaved draft)", () => {
      it("mints against the body's vendor agent id and carries a null row id", async () => {
        const resolveVoiceAgentRow = vi.fn();
        const ports = fakePorts({
          runner: fakeRunner(),
          over: { resolveVoiceAgentRow },
        });

        const result = await mintVoiceSession({
          ports,
          projectId: "p1",
          transport: "elevenlabs_convai",
          agentId: "agent_xyz",
          maxDurationSeconds: 300,
        });

        expect(resolveVoiceAgentRow).not.toHaveBeenCalled();
        expect(JSON.parse(result.sessionToken)).toMatchObject({
          agentExternalId: "agent_xyz",
          agentId: null,
        });
      });
    });

    describe("when the named row is missing or not a voice agent", () => {
      it("refuses with VoiceAgentRowNotFoundError and never calls the transport", async () => {
        const runner = fakeRunner();
        const ports = fakePorts({
          runner,
          over: {
            resolveVoiceAgentRow: vi.fn(async () => null),
          },
        });

        await expect(
          mintVoiceSession({
            ports,
            projectId: "p1",
            transport: "elevenlabs_convai",
            agentId: "agent_xyz",
            agentRowId: "agent_row",
            maxDurationSeconds: 300,
          }),
        ).rejects.toBeInstanceOf(VoiceAgentRowNotFoundError);
        expect(runner.mintSession).not.toHaveBeenCalled();
      });
    });

    describe("when the project has no key", () => {
      it("refuses with the missing-key message and never calls the transport", async () => {
        const runner = fakeRunner();
        const ports = fakePorts({
          runner,
          over: {
            resolveCredential: vi.fn(async () => null),
          },
        });

        await expect(
          mintVoiceSession({
            ports,
            projectId: "p1",
            transport: "elevenlabs_convai",
            agentId: "agent_xyz",
            agentRowId: "agent_row",
            maxDurationSeconds: 300,
          }),
        ).rejects.toBeInstanceOf(VoiceKeyMissingError);
        expect(runner.mintSession).not.toHaveBeenCalled();
      });
    });

    describe("when a phone target is called from the browser", () => {
      /** @scenario "A browser mint of a phone target is refused with a clear message" */
      it("rejects with the unavailable error before any credential lookup", async () => {
        const runner = fakeRunner();
        const resolveCredential = vi.fn(async () => CREDENTIAL);
        const ports = fakePorts({
          runner,
          over: {
            resolveCredential,
            registry: { elevenlabs_convai: runner, phone: phoneTransport },
          },
        });

        await expect(
          mintVoiceSession({
            ports,
            projectId: "p1",
            transport: "phone",
            agentId: "+14155550123",
            maxDurationSeconds: 300,
          }),
        ).rejects.toMatchObject({
          code: "voice_phone_transport_unavailable",
        });
        await expect(
          mintVoiceSession({
            ports,
            projectId: "p1",
            transport: "phone",
            agentId: "+14155550123",
            maxDurationSeconds: 300,
          }),
        ).rejects.toBeInstanceOf(VoicePhoneTransportUnavailableError);
        expect(resolveCredential).not.toHaveBeenCalled();
      });
    });
  });
});

describe("finishVoiceSession", () => {
  describe("given the voice session ports", () => {
    // A "Call it myself" call names a scenario, so it is written as a run and
    // judged; a drawer "Talk to it" call names none and is never written as a
    // run (#8020). Most run-writing behaviour below is therefore exercised on
    // the scenario path, with `scenarioId` set and `resolveScenarioSet`
    // resolving it. The drawer path is exercised in its own block.
    const SCENARIO_FINISH = {
      ...FINISH_BASE,
      token: { ...TOKEN, agentId: "agent_row" },
      scenarioId: "scenario_1",
    };

    describe("when the same Call it myself conversation is finished twice", () => {
      /** @scenario "Hanging up twice produces exactly one run" */
      it("writes the run once and returns the existing run the second time", async () => {
        const runner = fakeRunner();
        let stored: string | null = null;
        const writeCallRun = vi.fn(async ({ scenarioRunId }) => {
          stored = scenarioRunId;
        });
        // Once written, the run is finished SUCCESS (terminal), so the second
        // finish reads it back and short-circuits.
        const findExistingRun = vi.fn(async ({ scenarioRunId }) =>
          stored === scenarioRunId
            ? {
                agentId: "agent_row",
                status: ScenarioRunStatus.SUCCESS,
                source: "provider" as const,
                audioUrl: null,
                scenarioId: "scenario_1",
                scenarioSetId: "set_x",
              }
            : null,
        );
        const ports = fakePorts({
          runner,
          over: { writeCallRun, findExistingRun },
        });

        const first = await finishVoiceSession({ ports, ...SCENARIO_FINISH });
        const second = await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        expect(writeCallRun).toHaveBeenCalledTimes(1);
        expect(first.runId).toBe(second.runId);
        expect(second.agentId).toBe("agent_row");
      });
    });

    describe("when a drawer call is finished", () => {
      /** @scenario "A drawer Talk to it call writes no run" */
      /** @scenario "A drawer finish never mints a synthetic scenario id" */
      it("records the call traces but never writes a run or looks one up", async () => {
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const findExistingRun = vi.fn<VoiceSessionInfrastructure["findExistingRun"]>(
          async () => null,
        );
        const recordCallTraces = vi.fn<VoiceSessionInfrastructure["recordCallTraces"]>(
          async () => ({
            turnTraceIds: ["trace_0"],
          }),
        );
        const ports = fakePorts({
          runner: fakeRunner(),
          over: { writeCallRun, findExistingRun, recordCallTraces },
        });

        const result = await finishVoiceSession({
          ports,
          ...FINISH_BASE,
          token: { ...TOKEN, agentId: "agent_row" },
        });

        // No run is written for a drawer call, and there is never a run to
        // find for a conversation id with no scenario (#8020).
        expect(writeCallRun).not.toHaveBeenCalled();
        expect(findExistingRun).not.toHaveBeenCalled();
        // The traces are still recorded; that is where the transcript lives.
        expect(recordCallTraces).toHaveBeenCalledTimes(1);
        // The finish carries no run id and no scenario set id.
        expect(result.runId).toBe("");
        expect(result.scenarioSetId).toBeUndefined();
        // The agent id is still returned so the panel can register the row.
        expect(result.agentId).toBe("agent_row");
      });

      /** @scenario "Hanging up twice on a drawer call records traces and writes no run" */
      it("writes no run and records traces on each of two drawer finishes", async () => {
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const recordCallTraces = vi.fn<VoiceSessionInfrastructure["recordCallTraces"]>(
          async () => ({
            turnTraceIds: ["trace_0"],
          }),
        );
        const ports = fakePorts({
          runner: fakeRunner(),
          over: { writeCallRun, recordCallTraces },
        });

        const drawer = {
          ...FINISH_BASE,
          token: { ...TOKEN, agentId: "agent_row" },
        };
        const first = await finishVoiceSession({ ports, ...drawer });
        const second = await finishVoiceSession({ ports, ...drawer });

        // No run is ever written; the traces re-record with the same
        // deterministic ids, which the trace fold dedupes.
        expect(writeCallRun).not.toHaveBeenCalled();
        expect(recordCallTraces).toHaveBeenCalledTimes(2);
        expect(first.runId).toBe("");
        expect(second.runId).toBe("");
      });

      it("creates the voice agent from the form values on first hang-up", async () => {
        const runner = fakeRunner();
        const createVoiceAgent = vi.fn(async () => ({ id: "agent_new" }));
        const ports = fakePorts({ runner, over: { createVoiceAgent } });

        const result = await finishVoiceSession({
          ports,
          ...FINISH_BASE,
          name: "Support line",
        });

        expect(createVoiceAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Support line",
            agentId: "agent_xyz",
          }),
        );
        expect(result.agentId).toBe("agent_new");
      });
    });

    describe("when an existing run for the session is terminal", () => {
      /** @scenario "A retried hang-up leaves a terminal run untouched" */
      it("writes nothing and returns the existing run and agent id", async () => {
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({
          runner: fakeRunner(),
          over: {
            writeCallRun,
            findExistingRun: vi.fn(async () => ({
              agentId: "agent_existing",
              status: ScenarioRunStatus.SUCCESS,
              source: "provider" as const,
              audioUrl: null,
              scenarioId: "scenario_1",
              scenarioSetId: "set_x",
            })),
          },
        });

        const result = await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        expect(writeCallRun).not.toHaveBeenCalled();
        expect(result.agentId).toBe("agent_row");
      });

      /** @scenario "A retried hang-up leaves a terminal run untouched" */
      it("reports the persisted source and recording so a retry keeps Play", async () => {
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({
          runner: fakeRunner(),
          over: {
            writeCallRun,
            findExistingRun: vi.fn(async () => ({
              agentId: "agent_existing",
              status: ScenarioRunStatus.SUCCESS,
              source: "browser" as const,
              // Same-origin proxy URL the transport wrote, read back verbatim.
              audioUrl: "/api/voice/session/conv_1/audio?projectId=p1",
              scenarioId: "scenario_1",
              scenarioSetId: "set_terminal",
            })),
          },
        });

        const result = await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        expect(writeCallRun).not.toHaveBeenCalled();
        expect(result.source).toBe("browser");
        expect(result.hasAudio).toBe(true);
        expect(result.audioUrl).toBe(
          "/api/voice/session/conv_1/audio?projectId=p1",
        );
        // The persisted set id deep-links the retried run (AC14), without
        // re-resolving the scenario.
        expect(result.scenarioSetId).toBe("set_terminal");
      });

      /** @scenario "A retried hang-up leaves a terminal run untouched" */
      it("returns the terminal run without resolving a scenario that has since been archived", async () => {
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        // The scenario is gone: were it resolved, this would throw
        // scenario_not_found. The terminal short-circuit must run first.
        const resolveScenarioSet = vi.fn(async () => null);
        const ports = fakePorts({
          runner: fakeRunner(),
          over: {
            writeCallRun,
            resolveScenarioSet,
            findExistingRun: vi.fn(async () => ({
              agentId: "agent_existing",
              status: ScenarioRunStatus.SUCCESS,
              source: "provider" as const,
              audioUrl: null,
              scenarioId: null,
              scenarioSetId: null,
            })),
          },
        });

        const result = await finishVoiceSession({
          ports,
          ...SCENARIO_FINISH,
          scenarioId: "scenario_gone",
        });

        expect(resolveScenarioSet).not.toHaveBeenCalled();
        expect(writeCallRun).not.toHaveBeenCalled();
        expect(result.runId).toBeTruthy();
      });

      /** @scenario "A retried hang-up leaves a terminal run untouched" */
      it("records no traces and writes no run on the terminal short-circuit", async () => {
        const recordCallTraces = vi.fn(async () => ({ turnTraceIds: [] }));
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({
          runner: fakeRunner(),
          over: {
            recordCallTraces,
            writeCallRun,
            findExistingRun: vi.fn(async () => ({
              agentId: "agent_existing",
              status: ScenarioRunStatus.SUCCESS,
              source: "provider" as const,
              audioUrl: null,
              scenarioId: "scenario_1",
              scenarioSetId: "set_x",
            })),
          },
        });

        await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        expect(recordCallTraces).not.toHaveBeenCalled();
        expect(writeCallRun).not.toHaveBeenCalled();
      });
    });

    describe("when an existing run for the session is still in progress", () => {
      /** @scenario "A retried hang-up completes a half-written run" */
      it("re-drives writeCallRun with the same scenarioRunId", async () => {
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({
          runner: fakeRunner(),
          over: {
            writeCallRun,
            findExistingRun: vi.fn(async () => ({
              agentId: "agent_row",
              status: ScenarioRunStatus.IN_PROGRESS,
              source: "provider" as const,
              audioUrl: null,
              scenarioId: "scenario_1",
              scenarioSetId: "set_x",
            })),
          },
        });

        const result = await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        expect(writeCallRun).toHaveBeenCalledTimes(1);
        expect(writeCallRun.mock.calls[0]?.[0].scenarioRunId).toBe(
          result.runId,
        );
      });

      /** @scenario "A retried hang-up completes a half-written run" */
      it("reuses the half-written run's agent when the token carries none", async () => {
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const createVoiceAgent = vi.fn(async () => ({ id: "agent_new" }));
        const ports = fakePorts({
          runner: fakeRunner(),
          over: {
            writeCallRun,
            createVoiceAgent,
            findExistingRun: vi.fn(async () => ({
              agentId: "agent_existing",
              status: ScenarioRunStatus.IN_PROGRESS,
              source: null,
              audioUrl: null,
              scenarioId: "scenario_1",
              scenarioSetId: "set_x",
            })),
          },
        });

        // Token names no agent and the request has no name, so a fresh finish
        // would throw VoiceNameRequiredError; the re-drive reuses the id the
        // half-written run already attached instead (#7973).
        const result = await finishVoiceSession({
          ports,
          ...FINISH_BASE,
          token: { ...TOKEN, agentId: null },
          scenarioId: "scenario_1",
        });

        expect(createVoiceAgent).not.toHaveBeenCalled();
        expect(result.agentId).toBe("agent_existing");
      });

      /** @scenario "A retried hang-up completes a half-written run" */
      it("re-drives when the run was cancelled rather than dropping the transcript", async () => {
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({
          runner: fakeRunner(),
          over: {
            writeCallRun,
            findExistingRun: vi.fn(async () => ({
              agentId: "agent_row",
              status: ScenarioRunStatus.CANCELLED,
              source: null,
              audioUrl: null,
              scenarioId: "scenario_1",
              scenarioSetId: "set_x",
            })),
          },
        });

        const result = await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        expect(writeCallRun).toHaveBeenCalledTimes(1);
        expect(writeCallRun.mock.calls[0]?.[0].scenarioRunId).toBe(
          result.runId,
        );
      });

      /** @scenario "A retried hang-up completes a half-written run" */
      it("reuses the persisted scenario rather than re-resolving an archived one", async () => {
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        // Were it resolved now, the archived scenario would return null and the
        // run could never complete (#7973 AC1): the persisted set is reused.
        const resolveScenarioSet = vi.fn(async () => null);
        const ports = fakePorts({
          runner: fakeRunner(),
          over: {
            writeCallRun,
            resolveScenarioSet,
            findExistingRun: vi.fn(async () => ({
              agentId: "agent_row",
              status: ScenarioRunStatus.IN_PROGRESS,
              source: null,
              audioUrl: null,
              scenarioId: "scenario_archived",
              scenarioSetId: "set_a",
            })),
          },
        });

        await finishVoiceSession({
          ports,
          ...SCENARIO_FINISH,
          scenarioId: "scenario_archived",
        });

        expect(resolveScenarioSet).not.toHaveBeenCalled();
        expect(writeCallRun).toHaveBeenCalledWith(
          expect.objectContaining({
            scenario: {
              scenarioId: "scenario_archived",
              scenarioSetId: "set_a",
            },
          }),
        );
      });
    });

    describe("when the provider record names a different agent than the token", () => {
      it("refuses without writing the run", async () => {
        const runner = fakeRunner({
          fetchCallRecord: vi.fn(
            async (): Promise<CallRecord> => ({
              conversationId: "conv_1",
              transport: "elevenlabs_convai",
              agentExternalId: "someone_elses_agent",
              startedAt: 1000,
              endedAt: 2000,
              durationMs: 1000,
              turns: [],
              isCutAtLimit: false,
              source: "provider",
            }),
          ),
        });
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({ runner, over: { writeCallRun } });

        await expect(
          finishVoiceSession({ ports, ...SCENARIO_FINISH }),
        ).rejects.toBeInstanceOf(VoiceConversationMismatchError);
        expect(writeCallRun).not.toHaveBeenCalled();
      });
    });

    describe("when the limit ended the call", () => {
      it("carries the cut-at-limit flag onto the written record", async () => {
        const runner = fakeRunner();
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({ runner, over: { writeCallRun } });

        await finishVoiceSession({
          ports,
          ...SCENARIO_FINISH,
          isCutAtLimit: true,
        });

        const written = writeCallRun.mock.calls[0]?.[0] as {
          record: CallRecord;
        };
        expect(written.record.isCutAtLimit).toBe(true);
      });
    });

    describe("when the call is scored under a scenario", () => {
      /** @scenario "Call it myself against a scenario and be scored on its criteria" */
      /** @scenario "Call it myself still writes a run under its scenario after 8020" */
      it("writes the run under the scenario and its set so the scenario grades it", async () => {
        const runner = fakeRunner();
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const resolveScenarioSet = vi.fn(async () => ({
          scenarioSetId: "set_x",
        }));
        const ports = fakePorts({
          runner,
          over: { writeCallRun, resolveScenarioSet },
        });

        const result = await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        expect(resolveScenarioSet).toHaveBeenCalledWith({
          projectId: "p1",
          scenarioId: "scenario_1",
        });
        expect(writeCallRun).toHaveBeenCalledWith(
          expect.objectContaining({
            scenario: { scenarioId: "scenario_1", scenarioSetId: "set_x" },
          }),
        );
        expect(result.scenarioSetId).toBe("set_x");
      });

      /** @scenario "A drawer Talk to it call writes no run" */
      it("keeps a drawer call out of any scenario set and writes no run", async () => {
        const runner = fakeRunner();
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const resolveScenarioSet = vi.fn(async () => ({
          scenarioSetId: "set_x",
        }));
        const ports = fakePorts({
          runner,
          over: { writeCallRun, resolveScenarioSet },
        });

        const result = await finishVoiceSession({
          ports,
          ...FINISH_BASE,
          token: { ...TOKEN, agentId: "agent_row" },
        });

        expect(resolveScenarioSet).not.toHaveBeenCalled();
        expect(writeCallRun).not.toHaveBeenCalled();
        expect(result.scenarioSetId).toBeUndefined();
      });
    });

    describe("when a scenario call is finished", () => {
      /** @scenario "No ElevenLabs key leaves the server through any response or log" */
      it("returns no ElevenLabs key in the finish response", async () => {
        const runner = fakeRunner();
        const ports = fakePorts({ runner });

        const result = await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        expect(JSON.stringify(result)).not.toContain(CREDENTIAL.apiKey);
      });
    });

    describe("when the provider record has turns", () => {
      /** @scenario "A finished provider record with turns is written as the provider transcript" */
      it("writes the provider turns and marks the source provider", async () => {
        const runner = fakeRunner({
          fetchCallRecord: vi.fn(
            async (): Promise<CallRecord> => ({
              conversationId: "conv_1",
              transport: "elevenlabs_convai",
              agentExternalId: "agent_xyz",
              startedAt: 1000,
              endedAt: 2000,
              durationMs: 1000,
              turns: [{ role: "agent", text: "provider said this" }],
              isCutAtLimit: false,
              source: "provider",
            }),
          ),
        });
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({ runner, over: { writeCallRun } });

        const result = await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        const written = writeCallRun.mock.calls[0]?.[0] as {
          record: CallRecord;
        };
        expect(written.record.turns).toEqual([
          { role: "agent", text: "provider said this" },
        ]);
        expect(written.record.source).toBe("provider");
        expect(result.source).toBe("provider");
      });
    });

    describe("when the provider record has no turns but the browser captured some", () => {
      /** @scenario "A finished provider record with no turns keeps the live transcript" */
      it("writes the browser turns and marks the source browser", async () => {
        const runner = fakeRunner({
          fetchCallRecord: vi.fn(
            async (): Promise<CallRecord> => ({
              conversationId: "conv_1",
              transport: "elevenlabs_convai",
              agentExternalId: "agent_xyz",
              startedAt: 1000,
              endedAt: 2000,
              durationMs: 1000,
              turns: [],
              isCutAtLimit: false,
              source: "provider",
            }),
          ),
        });
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({ runner, over: { writeCallRun } });

        const result = await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        const written = writeCallRun.mock.calls[0]?.[0] as {
          record: CallRecord;
        };
        expect(written.record.turns).toEqual([{ role: "caller", text: "hi" }]);
        expect(written.record.source).toBe("browser");
        expect(result.source).toBe("browser");
      });

      /** @scenario "A finished provider record with no turns keeps the live transcript" */
      it("keeps the provider's recording even when the turns come from the browser", async () => {
        const runner = fakeRunner({
          fetchCallRecord: vi.fn(
            async (): Promise<CallRecord> => ({
              conversationId: "conv_1",
              transport: "elevenlabs_convai",
              agentExternalId: "agent_xyz",
              startedAt: 1000,
              endedAt: 2000,
              durationMs: 1000,
              turns: [],
              isCutAtLimit: false,
              source: "provider",
              audioUrl: "https://example.test/rec.mp3",
            }),
          ),
        });
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({ runner, over: { writeCallRun } });

        const result = await finishVoiceSession({
          ports,
          ...SCENARIO_FINISH,
          transcript: [
            { role: "caller" as const, text: "hi" },
            { role: "agent" as const, text: "hello" },
          ],
        });

        const written = writeCallRun.mock.calls[0]?.[0] as {
          record: CallRecord;
        };
        expect(written.record.turns).toEqual([
          { role: "caller", text: "hi" },
          { role: "agent", text: "hello" },
        ]);
        expect(written.record.source).toBe("browser");
        expect(written.record.audioUrl).toBe("https://example.test/rec.mp3");
        expect(result.source).toBe("browser");
        expect(result.hasAudio).toBe(true);
        expect(result.audioUrl).toBe("https://example.test/rec.mp3");
      });
    });

    describe("when the provider record is not ready (a failed status)", () => {
      /** @scenario "A failed provider record keeps the live transcript without a fetch-failed notice" */
      it("keeps the browser turns without flagging the fetch as failed", async () => {
        // The transport maps a "failed" status to null (not ready), so the
        // service sees no record and falls back to the live transcript.
        const runner = fakeRunner({ fetchCallRecord: vi.fn(async () => null) });
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({ runner, over: { writeCallRun } });

        const result = await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        const written = writeCallRun.mock.calls[0]?.[0] as {
          record: CallRecord;
        };
        expect(written.record.turns).toEqual([{ role: "caller", text: "hi" }]);
        expect(written.record.source).toBe("browser");
        expect(result.source).toBe("browser");
        expect(result.hasFetchFailed).toBe(false);
      });
    });

    describe("when the named scenario cannot be resolved", () => {
      /** @scenario "Finish refuses an unresolvable scenario and writes nothing" */
      it("refuses with scenario_not_found and writes nothing", async () => {
        const runner = fakeRunner();
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({
          runner,
          over: {
            writeCallRun,
            resolveScenarioSet: vi.fn(async () => null),
          },
        });

        await expect(
          finishVoiceSession({
            ports,
            ...SCENARIO_FINISH,
            scenarioId: "scenario_gone",
          }),
        ).rejects.toBeInstanceOf(VoiceScenarioNotFoundError);
        expect(writeCallRun).not.toHaveBeenCalled();
      });
    });

    describe("when the provider fetch throws", () => {
      /** @scenario "A recording fetch failure keeps the live transcript and shows a fetch-failed notice" */
      it("keeps the live transcript and flags the fetch as failed", async () => {
        const runner = fakeRunner({
          fetchCallRecord: vi.fn(async () => {
            throw new Error("key rotated");
          }),
        });
        const ports = fakePorts({ runner });

        const result = await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        expect(result.hasFetchFailed).toBe(true);
        expect(result.source).toBe("browser");
        expect(result.hasAudio).toBe(false);
      });
    });

    describe("when a fresh call is finished", () => {
      /** @scenario "A finished browser call writes one trace per exchange and every message links to its exchange's trace" */
      it("records the call traces before writing the run and passes the ids through", async () => {
        const recordCallTraces = vi.fn<VoiceSessionInfrastructure["recordCallTraces"]>(
          async () => ({
            turnTraceIds: ["trace_x"],
          }),
        );
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({
          runner: fakeRunner(),
          over: { recordCallTraces, writeCallRun },
        });

        await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        expect(recordCallTraces).toHaveBeenCalledTimes(1);
        // Ordering: the traces are recorded before the run is written.
        expect(
          (recordCallTraces.mock.invocationCallOrder[0] ?? 0) <
            (writeCallRun.mock.invocationCallOrder[0] ?? 0),
        ).toBe(true);
        // The record and run id the run write sees are the ones the traces were
        // recorded from.
        expect(recordCallTraces.mock.calls[0]?.[0]).toMatchObject({
          projectId: "p1",
          scenarioRunId: writeCallRun.mock.calls[0]?.[0].scenarioRunId,
        });
        expect(writeCallRun.mock.calls[0]?.[0].turnTraceIds).toEqual([
          "trace_x",
        ]);
      });
    });

    describe("when a half-written run is re-driven", () => {
      /** @scenario "A re-driven finish writes the same trace ids" */
      it("records the call traces again so the deterministic ids re-attach", async () => {
        const recordCallTraces = vi.fn<VoiceSessionInfrastructure["recordCallTraces"]>(
          async () => ({
            turnTraceIds: ["trace_x"],
          }),
        );
        const writeCallRun = vi.fn<VoiceSessionInfrastructure["writeCallRun"]>(
          async () => {},
        );
        const ports = fakePorts({
          runner: fakeRunner(),
          over: {
            recordCallTraces,
            writeCallRun,
            findExistingRun: vi.fn(async () => ({
              agentId: "agent_row",
              status: ScenarioRunStatus.IN_PROGRESS,
              source: "provider" as const,
              audioUrl: null,
              scenarioId: "scenario_1",
              scenarioSetId: "set_x",
            })),
          },
        });

        await finishVoiceSession({ ports, ...SCENARIO_FINISH });

        expect(recordCallTraces).toHaveBeenCalledTimes(1);
        expect(writeCallRun.mock.calls[0]?.[0].turnTraceIds).toEqual([
          "trace_x",
        ]);
      });
    });
  });
});

describe("authorizeRecordingPlayback", () => {
  describe("given a recording-playback request", () => {
    describe("when a scenario run exists for the conversation", () => {
      it("authorizes with the credential and never calls the provider", async () => {
        const fetchCallRecord = vi.fn(async () => null);
        const ports = fakePorts({
          runner: fakeRunner({ fetchCallRecord }),
          over: {
            findExistingRun: vi.fn(async () => ({
              agentId: "agent_row",
              status: ScenarioRunStatus.SUCCESS,
              source: "provider" as const,
              audioUrl: "/api/voice/session/conv_1/audio?projectId=p1",
              scenarioId: "scenario_1",
              scenarioSetId: "set_x",
            })),
          },
        });

        const credential = await authorizeRecordingPlayback({
          ports,
          projectId: "p1",
          conversationId: "conv_1",
        });

        expect(credential).toEqual(CREDENTIAL);
        expect(fetchCallRecord).not.toHaveBeenCalled();
      });
    });

    describe("when there is no run but the provider agent id matches a saved row", () => {
      /** @scenario "A drawer call's recording still plays after hang-up" */
      it("authorizes with the credential", async () => {
        const hasVoiceAgentForExternalId = vi.fn(async () => true);
        const fetchCallRecord = vi.fn(
          async (): Promise<CallRecord> => ({
            conversationId: "conv_1",
            transport: "elevenlabs_convai",
            agentExternalId: "agent_xyz",
            startedAt: 1000,
            endedAt: 2000,
            durationMs: 1000,
            turns: [],
            isCutAtLimit: false,
            source: "provider",
          }),
        );
        const ports = fakePorts({
          runner: fakeRunner({ fetchCallRecord }),
          over: { hasVoiceAgentForExternalId },
        });

        const credential = await authorizeRecordingPlayback({
          ports,
          projectId: "p1",
          conversationId: "conv_1",
        });

        expect(credential).toEqual(CREDENTIAL);
        expect(hasVoiceAgentForExternalId).toHaveBeenCalledWith({
          projectId: "p1",
          transport: "elevenlabs_convai",
          agentExternalId: "agent_xyz",
        });
      });
    });

    describe("when there is no run and no saved row matches", () => {
      it("refuses and never returns the credential", async () => {
        const ports = fakePorts({
          runner: fakeRunner({
            fetchCallRecord: vi.fn(
              async (): Promise<CallRecord> => ({
                conversationId: "conv_1",
                transport: "elevenlabs_convai",
                agentExternalId: "agent_other",
                startedAt: 1000,
                endedAt: 2000,
                durationMs: 1000,
                turns: [],
                isCutAtLimit: false,
                source: "provider",
              }),
            ),
          }),
          over: { hasVoiceAgentForExternalId: vi.fn(async () => false) },
        });

        await expect(
          authorizeRecordingPlayback({
            ports,
            projectId: "p1",
            conversationId: "conv_1",
          }),
        ).rejects.toBeInstanceOf(VoiceRecordingUnavailableError);
      });
    });

    describe("when there is no run and the provider fetch fails", () => {
      it("refuses without consulting the agent rows", async () => {
        const hasVoiceAgentForExternalId = vi.fn(async () => true);
        const ports = fakePorts({
          runner: fakeRunner({
            fetchCallRecord: vi.fn(async () => {
              throw new Error("provider down");
            }),
          }),
          over: { hasVoiceAgentForExternalId },
        });

        await expect(
          authorizeRecordingPlayback({
            ports,
            projectId: "p1",
            conversationId: "conv_1",
          }),
        ).rejects.toBeInstanceOf(VoiceRecordingUnavailableError);
        expect(hasVoiceAgentForExternalId).not.toHaveBeenCalled();
      });
    });

    describe("when the project has no provider key", () => {
      it("refuses with the key-missing error", async () => {
        const ports = fakePorts({
          runner: fakeRunner(),
          over: { resolveCredential: vi.fn(async () => null) },
        });

        await expect(
          authorizeRecordingPlayback({
            ports,
            projectId: "p1",
            conversationId: "conv_1",
          }),
        ).rejects.toBeInstanceOf(VoiceRecordingKeyMissingError);
      });
    });

    describe("given a non ElevenLabs credential", () => {
      describe("when playback is authorized", () => {
        it("throws", async () => {
          const ports = fakePorts({
            runner: fakeRunner(),
            over: {
              resolveCredential: vi.fn(async () => ({
                kind: "twilio" as const,
                accountSid: "AC123",
                authToken: "tok-secret",
                fromNumber: "+14155550000",
              })),
            },
          });

          await expect(
            authorizeRecordingPlayback({
              ports,
              projectId: "p1",
              conversationId: "conv_1",
            }),
          ).rejects.toThrow(
            "Recording playback is only available for ElevenLabs conversations",
          );
        });
      });
    });
  });
});

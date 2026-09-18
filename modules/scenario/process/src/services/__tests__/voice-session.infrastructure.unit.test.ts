import { ScenarioRunStatus } from "@langwatch/scenario-contract";
/**
 * Infrastructure composition for "Talk to it" route over in-memory fakes.
 * Verifies infrastructure translates service results to promised shapes.
 * @see specs/features/agents/voice-agents-v1.feature
 */
import type {
  VoiceTransport,
  VoiceTransportRunner,
} from "@langwatch/scenario-contract/voice-runtime";
import { describe, expect, it, vi } from "vitest";

import {
  createVoiceSessionInfrastructureFromServices as composeVoiceSessionInfrastructure,
  type VoiceSessionServices,
} from "../voice-session.infrastructure.ts";

/** The agent row the fakes hand back, loose about the fields this file does
 *  not read so the test does not restate the whole Agent shape. */
interface AgentRow {
  id: string;
  projectId: string;
  name: string;
  type: string;
  config: unknown;
  [field: string]: unknown;
}

/** The scenario row `resolveScenarioSet` reads, narrowed to what it reads. */
interface ScenarioRow {
  id: string;
  testSuiteId: string | null;
}

// findExistingRun reads the run through the injected simulation read; the fake
// lets each case hand back a run (or none) without a datastore.
const findScenarioRunData = vi.fn();

/**
 * Composes the infrastructure over defaults for every collaborator this file
 * does not exercise, so each case names only the fakes it cares about.
 */
function createVoiceSessionInfrastructureFromServices(
  over: Pick<VoiceSessionServices, "agentService" | "scenarioService"> &
    Partial<VoiceSessionServices>,
) {
  return composeVoiceSessionInfrastructure({
    elevenLabsCredentials: { resolveForProject: vi.fn(async () => null) },
    simulations: {
      findScenarioRunData: (input) => findScenarioRunData(input),
    },
    recordCallTraces: vi.fn(async () => ({ turnTraceIds: [] })),
    writeCallRun: vi.fn(async () => {}),
    signSessionToken: vi.fn(() => "signed-token"),
    registry: fakeRegistry(),
    ...over,
  });
}

function fakeAgentService(over: {
  getById?: (input: { id: string; projectId: string }) => Promise<AgentRow | null>;
  createVoiceAgent?: (input: unknown) => Promise<{ id: string }>;
  hasVoiceAgentForExternalId?: (input: unknown) => Promise<boolean>;
}) {
  return {
    getById: over.getById ?? vi.fn(async () => null),
    createVoiceAgent:
      over.createVoiceAgent ??
      vi.fn(async () => {
        throw new Error("not stubbed");
      }),
    hasVoiceAgentForExternalId: over.hasVoiceAgentForExternalId ?? vi.fn(async () => false),
  };
}

function fakeScenarioService(over: {
  getById?: (input: { id: string; projectId: string }) => Promise<ScenarioRow | null>;
}) {
  return {
    getById: over.getById ?? vi.fn(async () => null),
  };
}

function fakeRegistry(): Record<VoiceTransport, VoiceTransportRunner> {
  return {
    elevenlabs_convai: {
      missingKeyMessage: "No ElevenLabs key in this project",
      createAgentAdapter: vi.fn(),
      mintSession: vi.fn(),
      fetchCallRecord: vi.fn(),
      endCall: vi.fn(),
    },
    phone: {
      missingKeyMessage: "No Twilio credentials in this project",
      createAgentAdapter: vi.fn(),
      mintSession: vi.fn(),
      fetchCallRecord: vi.fn(),
      endCall: vi.fn(),
      assertAvailable: vi.fn(),
    },
  };
}

function voiceAgentRow(over: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent_row",
    projectId: "project_1",
    name: "My agent",
    type: "voice",
    config: { transport: "elevenlabs_convai", agentId: "el_agent_1" },
    environment: null,
    ownerUserId: null,
    hostLabel: null,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    inputFields: [],
    outputFields: [],
    fieldsResolved: true,
    ...over,
  } as unknown as AgentRow;
}

describe("Feature: voice-session infrastructure composition", () => {
  describe("given resolveVoiceAgentRow", () => {
    describe("when the row is a saved voice agent", () => {
      it("resolves the vendor agent id off a saved voice agent row", async () => {
        const agentService = fakeAgentService({
          getById: vi.fn(async () => voiceAgentRow()),
        });
        const ports = createVoiceSessionInfrastructureFromServices({
          agentService,
          scenarioService: fakeScenarioService({}),
        });

        const row = await ports.resolveVoiceAgentRow({
          projectId: "project_1",
          agentRowId: "agent_row",
        });

        expect(row).toEqual({ id: "agent_row", agentExternalId: "el_agent_1" });
        expect(agentService.getById).toHaveBeenCalledWith({
          id: "agent_row",
          projectId: "project_1",
        });
      });
    });

    describe("when the row is not a voice agent", () => {
      it("answers null for a row that is not a voice agent", async () => {
        const agentService = fakeAgentService({
          getById: vi.fn(async () => voiceAgentRow({ type: "http" })),
        });
        const ports = createVoiceSessionInfrastructureFromServices({
          agentService,
          scenarioService: fakeScenarioService({}),
        });

        const row = await ports.resolveVoiceAgentRow({
          projectId: "project_1",
          agentRowId: "agent_row",
        });

        expect(row).toBeNull();
      });
    });

    describe("when the row does not exist", () => {
      it("answers null when the row does not exist", async () => {
        const ports = createVoiceSessionInfrastructureFromServices({
          agentService: fakeAgentService({}),
          scenarioService: fakeScenarioService({}),
        });

        const row = await ports.resolveVoiceAgentRow({
          projectId: "project_1",
          agentRowId: "missing",
        });

        expect(row).toBeNull();
      });
    });
  });

  describe("given createVoiceAgent", () => {
    describe("when a new voice agent is created", () => {
      it("creates the voice agent through the identity-key-deduped service method", async () => {
        // The infrastructure delegates to AgentService.createVoiceAgent, which
        // folds the row on its identity key so a retried finish reuses one
        // row (#8020).
        const createVoiceAgent = vi.fn(async () => ({ id: "agent_new" }));
        const ports = createVoiceSessionInfrastructureFromServices({
          agentService: fakeAgentService({ createVoiceAgent }),
          scenarioService: fakeScenarioService({}),
        });

        const created = await ports.createVoiceAgent({
          projectId: "project_1",
          name: "New agent",
          transport: "elevenlabs_convai",
          agentId: "el_agent_1",
        });

        expect(created).toEqual({ id: "agent_new" });
        expect(createVoiceAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "project_1",
            name: "New agent",
            transport: "elevenlabs_convai",
            agentId: "el_agent_1",
          }),
        );
      });
    });
  });

  describe("given hasVoiceAgentForExternalId", () => {
    describe("when the request carries a project, transport and vendor agent id", () => {
      it("delegates the identity-key match to the service", async () => {
        const hasVoiceAgentForExternalId = vi.fn(async () => true);
        const ports = createVoiceSessionInfrastructureFromServices({
          agentService: fakeAgentService({ hasVoiceAgentForExternalId }),
          scenarioService: fakeScenarioService({}),
        });

        const matched = await ports.hasVoiceAgentForExternalId({
          projectId: "project_1",
          transport: "elevenlabs_convai",
          agentExternalId: "el_agent_1",
        });

        expect(matched).toBe(true);
        expect(hasVoiceAgentForExternalId).toHaveBeenCalledWith({
          projectId: "project_1",
          transport: "elevenlabs_convai",
          agentExternalId: "el_agent_1",
        });
      });
    });
  });

  describe("given resolveScenarioSet", () => {
    describe("when the scenario is filed in a suite", () => {
      it("resolves the suite set when the scenario is filed in one", async () => {
        const ports = createVoiceSessionInfrastructureFromServices({
          agentService: fakeAgentService({}),
          scenarioService: fakeScenarioService({
            getById: vi.fn(
              async () => ({ id: "scenario_1", testSuiteId: "suite_1" }) as ScenarioRow,
            ),
          }),
        });

        const result = await ports.resolveScenarioSet?.({
          projectId: "project_1",
          scenarioId: "scenario_1",
        });

        expect(result?.scenarioSetId).toContain("suite_1");
      });
    });

    describe("when the scenario is unfiled", () => {
      it("resolves the project's on-platform set when the scenario is unfiled", async () => {
        const ports = createVoiceSessionInfrastructureFromServices({
          agentService: fakeAgentService({}),
          scenarioService: fakeScenarioService({
            getById: vi.fn(async () => ({ id: "scenario_1", testSuiteId: null }) as ScenarioRow),
          }),
        });

        const result = await ports.resolveScenarioSet?.({
          projectId: "project_1",
          scenarioId: "scenario_1",
        });

        expect(result?.scenarioSetId).toContain("project_1");
      });
    });

    describe("when the scenario is gone", () => {
      it("answers null when the scenario is gone", async () => {
        const ports = createVoiceSessionInfrastructureFromServices({
          agentService: fakeAgentService({}),
          scenarioService: fakeScenarioService({}),
        });

        const result = await ports.resolveScenarioSet?.({
          projectId: "project_1",
          scenarioId: "missing",
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("given findExistingRun", () => {
    const ports = () =>
      createVoiceSessionInfrastructureFromServices({
        agentService: fakeAgentService({}),
        scenarioService: fakeScenarioService({}),
      });

    describe("when the run carries well-formed metadata", () => {
      it("maps agent id, source, recording and scenario set through", async () => {
        findScenarioRunData.mockResolvedValueOnce({
          status: ScenarioRunStatus.SUCCESS,
          scenarioId: "scenario_1",
          scenarioSetId: "set_1",
          metadata: {
            agentId: "agent_row",
            source: "provider",
            audioUrl: "/api/voice/session/conv_1/audio?projectId=p1",
          },
        });

        const existing = await ports().findExistingRun({
          projectId: "p1",
          scenarioRunId: "run_1",
        });

        expect(existing).toEqual({
          agentId: "agent_row",
          status: ScenarioRunStatus.SUCCESS,
          source: "provider",
          audioUrl: "/api/voice/session/conv_1/audio?projectId=p1",
          scenarioId: "scenario_1",
          scenarioSetId: "set_1",
        });
      });
    });

    describe("when the metadata fields are the wrong type", () => {
      it("narrows a non-source and a non-string recording to null", async () => {
        findScenarioRunData.mockResolvedValueOnce({
          status: ScenarioRunStatus.SUCCESS,
          scenarioId: undefined,
          scenarioSetId: undefined,
          metadata: { agentId: 7, source: 42, audioUrl: {} },
        });

        const existing = await ports().findExistingRun({
          projectId: "p1",
          scenarioRunId: "run_1",
        });

        expect(existing).toEqual({
          agentId: null,
          status: ScenarioRunStatus.SUCCESS,
          source: null,
          audioUrl: null,
          scenarioId: null,
          scenarioSetId: null,
        });
      });
    });

    describe("when no run exists for the id", () => {
      it("answers null", async () => {
        findScenarioRunData.mockResolvedValueOnce(null);

        const existing = await ports().findExistingRun({
          projectId: "p1",
          scenarioRunId: "missing",
        });

        expect(existing).toBeNull();
      });
    });
  });

  describe("given recordCallTraces", () => {
    describe("when the infrastructure is composed", () => {
      it("binds the trace writer as the recordCallTraces function", () => {
        const ports = createVoiceSessionInfrastructureFromServices({
          agentService: fakeAgentService({}),
          scenarioService: fakeScenarioService({}),
        });

        expect(typeof ports.recordCallTraces).toBe("function");
      });
    });
  });

  describe("given audioProxyUrl", () => {
    describe("when the proxy url is built", () => {
      it("builds the same-origin proxy path carrying the project", () => {
        const ports = createVoiceSessionInfrastructureFromServices({
          agentService: fakeAgentService({}),
          scenarioService: fakeScenarioService({}),
        });

        expect(ports.audioProxyUrl({ conversationId: "conv 1", projectId: "p1" })).toBe(
          "/api/voice/session/conv%201/audio?projectId=p1",
        );
      });
    });
  });
});

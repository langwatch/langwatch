/**
 * The ports composition for the "Talk to it" route, driven against in-memory
 * fakes for `AgentService`/`ScenarioService` — no Prisma in the loop. Verifies
 * the ports translate service results into the shapes
 * {@link VoiceSessionPorts} promises, since that translation (the config
 * parse, the scenario-set lookup) is the only logic this module owns; the
 * services themselves are exercised by their own tests.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { Scenario } from "~/generated/prisma/client";
import type { AgentWithFields } from "~/server/agents/agent-fields";
import { createVoiceSessionPortsFromServices } from "../voice-session.ports";

function fakeAgentService(over: {
  getById?: (input: {
    id: string;
    projectId: string;
  }) => Promise<AgentWithFields | null>;
  create?: (input: unknown) => Promise<AgentWithFields>;
}) {
  return {
    getById: over.getById ?? vi.fn(async () => null),
    create:
      over.create ??
      vi.fn(async () => {
        throw new Error("not stubbed");
      }),
  };
}

function fakeScenarioService(over: {
  getById?: (input: {
    id: string;
    projectId: string;
  }) => Promise<Scenario | null>;
}) {
  return {
    getById: over.getById ?? vi.fn(async () => null),
  };
}

function voiceAgentRow(over: Partial<AgentWithFields> = {}): AgentWithFields {
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
  } as unknown as AgentWithFields;
}

describe("Feature: voice-session ports composition", () => {
  describe("given resolveVoiceAgentRow", () => {
    describe("when the row is a saved voice agent", () => {
      it("resolves the vendor agent id off a saved voice agent row", async () => {
        const agentService = fakeAgentService({
          getById: vi.fn(async () => voiceAgentRow()),
        });
        const ports = createVoiceSessionPortsFromServices({
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
        const ports = createVoiceSessionPortsFromServices({
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
        const ports = createVoiceSessionPortsFromServices({
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
      it("creates a voice-typed agent row through the service", async () => {
        const create = vi.fn(async () => voiceAgentRow({ id: "agent_new" }));
        const ports = createVoiceSessionPortsFromServices({
          agentService: fakeAgentService({ create }),
          scenarioService: fakeScenarioService({}),
        });

        const created = await ports.createVoiceAgent({
          projectId: "project_1",
          name: "New agent",
          transport: "elevenlabs_convai",
          agentId: "el_agent_1",
        });

        expect(created).toEqual({ id: "agent_new" });
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "project_1",
            name: "New agent",
            type: "voice",
            config: { transport: "elevenlabs_convai", agentId: "el_agent_1" },
          }),
        );
      });
    });
  });

  describe("given resolveScenarioSet", () => {
    describe("when the scenario is filed in a suite", () => {
      it("resolves the suite set when the scenario is filed in one", async () => {
        const ports = createVoiceSessionPortsFromServices({
          agentService: fakeAgentService({}),
          scenarioService: fakeScenarioService({
            getById: vi.fn(
              async () =>
                ({ id: "scenario_1", testSuiteId: "suite_1" }) as Scenario,
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
        const ports = createVoiceSessionPortsFromServices({
          agentService: fakeAgentService({}),
          scenarioService: fakeScenarioService({
            getById: vi.fn(
              async () => ({ id: "scenario_1", testSuiteId: null }) as Scenario,
            ),
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
        const ports = createVoiceSessionPortsFromServices({
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

  describe("given audioProxyUrl", () => {
    describe("when the proxy url is built", () => {
      it("builds the same-origin proxy path carrying the project", () => {
        const ports = createVoiceSessionPortsFromServices({
          agentService: fakeAgentService({}),
          scenarioService: fakeScenarioService({}),
        });

        expect(
          ports.audioProxyUrl({ conversationId: "conv 1", projectId: "p1" }),
        ).toBe("/api/voice/session/conv%201/audio?projectId=p1");
      });
    });
  });
});

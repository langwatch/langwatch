/**
 * @vitest-environment jsdom
 * "Talk to it" is offered on a voice agent's card menu only while the flag is on.
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { AgentWithFields } from "@langwatch/agent-contract";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const voiceAgent: AgentWithFields = {
  id: "agent_voice",
  projectId: "test-project",
  name: "Support line",
  type: "voice",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date("2026-08-30T09:00:00.000Z"),
  updatedAt: new Date("2026-08-30T09:00:00.000Z"),
  copyCount: 0,
  config: { transport: "elevenlabs_convai", agentId: "el_agent" },
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
};

vi.mock("../../../behavior/agent-api.ts", () => ({
  agentApi: {
    agents: {
      testRun: { useMutation: () => ({ mutate: vi.fn() }) },
      getAll: {
        useQuery: () => ({ data: [voiceAgent], isLoading: false, error: null, isFetching: false }),
      },
    },
    useUtils: () => ({ agents: { getAll: { invalidate: vi.fn() } } }),
  },
}));

// This package runs without isolation: start from fresh modules, and leave none behind.
vi.resetModules();
afterAll(() => {
  vi.resetModules();
});
const { voiceState } =
  await import("../../../features/voice-editor/ui/sections/__tests__/voice-editor-doubles.test-helpers.tsx");
const { VoiceTestHost, resetVoiceState } =
  await import("../../../features/voice-editor/ui/sections/__tests__/voice-editor.test-helpers.tsx");
const { AgentManagementHostProvider } = await import("../../../model/agent-management-host.ts");
const { AgentManagementScreen } = await import("../agent-management-screen.tsx");

async function openCardMenu() {
  const host = new VoiceTestHost();
  render(
    <ChakraProvider value={defaultSystem}>
      <AgentManagementHostProvider value={host}>
        <AgentManagementScreen />
      </AgentManagementHostProvider>
    </ChakraProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText(`Actions for ${voiceAgent.name}`));
  await screen.findByText("Edit");
  return { host, user };
}

describe("AgentCard Talk to it", () => {
  beforeEach(resetVoiceState);

  describe("given the release_voice_agents_enabled flag is on", () => {
    /** @scenario "Talk to it appears on a voice agent's card menu while the flag is on" */
    it("offers Talk to it on a voice agent, opening the editor on its call panel", async () => {
      const { host, user } = await openCardMenu();
      await user.click(screen.getByTestId(`agent-talk-${voiceAgent.id}`));
      expect(host.editorsOpened).toEqual([
        { drawer: "agentVoiceEditor", agentId: voiceAgent.id, talk: true },
      ]);
    });
  });

  describe("given the release_voice_agents_enabled flag is off", () => {
    /** @scenario "Talk to it is hidden on a voice agent's card menu while the flag is off" */
    it("does not offer Talk to it", async () => {
      voiceState.flagOn = false;
      await openCardMenu();
      expect(screen.queryByTestId(`agent-talk-${voiceAgent.id}`)).not.toBeInTheDocument();
    });
  });
});

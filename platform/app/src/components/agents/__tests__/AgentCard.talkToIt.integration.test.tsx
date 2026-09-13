/**
 * @vitest-environment jsdom
 *
 * "Talk to it" is offered on a voice agent's card menu only while the
 * project's release_voice_agents_enabled flag is on.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { AgentCard } from "../AgentCard";

let mockVoiceAgentsEnabled = true;
vi.mock("../voice/useVoiceAgentsEnabled", () => ({
  useVoiceAgentsEnabled: () => mockVoiceAgentsEnabled,
}));

vi.mock("~/features/langy/components/LangyContextTarget", () => ({
  LangyContextTarget: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

const voiceAgent = {
  id: "agent_voice",
  name: "Support line",
  type: "voice",
  config: { transport: "elevenlabs_convai", agentId: "el_agent" },
  updatedAt: new Date("2026-08-30T09:00:00Z"),
  createdAt: new Date("2026-08-30T09:00:00Z"),
  copiedFromAgentId: null,
} as unknown as TypedAgent;

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

async function openCardMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(`Actions for ${voiceAgent.name}`));
}

afterEach(cleanup);

describe("AgentCard Talk to it", () => {
  describe("given the release_voice_agents_enabled flag is on", () => {
    /** @scenario "Talk to it appears on a voice agent's card menu while the flag is on" */
    it("offers Talk to it on a voice agent", async () => {
      mockVoiceAgentsEnabled = true;
      render(<AgentCard agent={voiceAgent} onTalkToIt={vi.fn()} />, {
        wrapper: Wrapper,
      });

      await openCardMenu();

      expect(
        await screen.findByTestId(`agent-talk-${voiceAgent.id}`),
      ).toBeInTheDocument();
    });
  });

  describe("given the release_voice_agents_enabled flag is off", () => {
    /** @scenario "Talk to it is hidden on a voice agent's card menu while the flag is off" */
    it("does not offer Talk to it", async () => {
      mockVoiceAgentsEnabled = false;
      render(
        <AgentCard agent={voiceAgent} onTalkToIt={vi.fn()} onEdit={vi.fn()} />,
        { wrapper: Wrapper },
      );

      await openCardMenu();

      // Wait for the menu to actually open (Edit is unconditional here)
      // before asserting Talk to it never appears in it.
      await screen.findByText("Edit");
      expect(
        screen.queryByTestId(`agent-talk-${voiceAgent.id}`),
      ).not.toBeInTheDocument();
    });
  });
});

/**
 * @vitest-environment jsdom
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../../../behavior/agent-api.ts",
  async () => (await import("./voice-editor-doubles.test-helpers.tsx")).agentApiDouble,
);
vi.mock(
  "@langwatch/browser-host/drawer",
  async () => (await import("./voice-editor-doubles.test-helpers.tsx")).drawerDouble,
);
vi.mock(
  "../../../behavior/lent-talk-to-it-panel.tsx",
  async () => (await import("./voice-editor-doubles.test-helpers.tsx")).talkPanelDouble,
);

// This package runs without isolation: start from fresh modules, and leave none behind.
vi.resetModules();
afterAll(() => {
  vi.resetModules();
});
const { createMock, ELEVENLABS_KEYED_PROVIDER, updateMock, voiceState, VOICE_AGENT } =
  await import("./voice-editor-doubles.test-helpers.tsx");
const { renderVoiceDrawer, resetVoiceState } = await import("./voice-editor.test-helpers.tsx");

describe("AgentVoiceEditorDrawer Talk to it", () => {
  beforeEach(resetVoiceState);

  describe("given a new draft", () => {
    /** @scenario "Talk to it is disabled until the agent id is filled" */
    it("disables Talk to it until the agent id is filled, then enables it without saving", async () => {
      const user = userEvent.setup();
      voiceState.providers = [ELEVENLABS_KEYED_PROVIDER];
      renderVoiceDrawer();
      const talk = await screen.findByTestId("voice-agent-talk");
      expect(talk).toBeDisabled();
      expect(talk).toHaveAttribute("title", "Enter the agent id first");
      await user.type(screen.getByTestId("voice-agent-id-input"), "agent_1");
      expect(talk).toBeEnabled();
    });
  });

  describe("when Talk to it has already created the agent row for a new draft", () => {
    it("updates the created row instead of inserting a duplicate on Save", async () => {
      const user = userEvent.setup();
      voiceState.providers = [ELEVENLABS_KEYED_PROVIDER];
      renderVoiceDrawer();
      await user.type(screen.getByTestId("voice-agent-name-input"), "Support");
      await user.type(screen.getByTestId("voice-agent-id-input"), "agent_1");
      await user.click(await screen.findByTestId("voice-agent-talk"));
      await user.click(await screen.findByTestId("mock-panel-created-row"));
      await user.click(screen.getByTestId("save-agent-button"));
      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ id: "agent_row_created" }));
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe("given the card menu opened Talk to it directly (?drawer.talk=1)", () => {
    /** @scenario "Talk to it appears on a voice agent's card menu while the flag is on" */
    it("opens the drawer with the call panel already visible", async () => {
      voiceState.agentById = VOICE_AGENT;
      voiceState.providers = [ELEVENLABS_KEYED_PROVIDER];
      renderVoiceDrawer({ agentId: "voice_1", talk: "1" });
      expect(await screen.findByTestId("mock-panel-created-row")).toBeInTheDocument();
      expect(screen.queryByTestId("voice-agent-name-input")).not.toBeInTheDocument();
    });
  });

  describe("when the saved agent's project has no ElevenLabs key", () => {
    /** @scenario "Talk to it is disabled when the project has no ElevenLabs key" */
    it("disables Talk to it with the tooltip 'Add an ElevenLabs key first'", async () => {
      voiceState.agentById = VOICE_AGENT;
      renderVoiceDrawer({ agentId: "voice_1" });
      const talk = await screen.findByTestId("voice-agent-talk");
      expect(talk).toBeDisabled();
      expect(talk).toHaveAttribute("title", "Add an ElevenLabs key first");
    });
  });
});

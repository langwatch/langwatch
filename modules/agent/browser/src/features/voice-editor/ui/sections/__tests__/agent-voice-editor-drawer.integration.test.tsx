/**
 * @vitest-environment jsdom
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { screen, waitFor } from "@testing-library/react";
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
const { createMock, ELEVENLABS_KEYED_PROVIDER, voiceState } =
  await import("./voice-editor-doubles.test-helpers.tsx");
const { renderVoiceDrawer, resetVoiceState } = await import("./voice-editor.test-helpers.tsx");

describe("AgentVoiceEditorDrawer", () => {
  beforeEach(resetVoiceState);

  describe("given the release_voice_agents_enabled flag is off", () => {
    /** @scenario "The voice agent editor shows a disabled message when opened with the flag off" */
    it("shows a disabled message instead of the editor", async () => {
      voiceState.flagOn = false;
      renderVoiceDrawer();
      expect(await screen.findByTestId("voice-agents-disabled-message")).toBeInTheDocument();
      expect(screen.queryByTestId("voice-agent-name-input")).not.toBeInTheDocument();
    });
  });

  describe("when a new voice agent drawer is drawn", () => {
    it("renders Name, Reached via (transport preselected) and Agent id", async () => {
      renderVoiceDrawer();
      const transport = await screen.findByTestId<HTMLSelectElement>(
        "voice-agent-transport-select",
      );
      expect(transport.value).toBe("elevenlabs_convai");
      expect(screen.getByTestId("voice-agent-id-input")).toBeInTheDocument();
    });

    it("shows inline errors and does not save when Name and Agent id are empty", async () => {
      const user = userEvent.setup();
      renderVoiceDrawer();
      const save = await screen.findByTestId("save-agent-button");
      expect(save).toBeEnabled();
      await user.click(save);
      expect(screen.getByText("Name is required")).toBeInTheDocument();
      expect(screen.getByText("Agent id is required")).toBeInTheDocument();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("creates with type voice and a trimmed agent id", async () => {
      const user = userEvent.setup();
      renderVoiceDrawer();
      await user.type(screen.getByTestId("voice-agent-name-input"), "Support line");
      await user.type(screen.getByTestId("voice-agent-id-input"), "  agent_123  ");
      await user.click(screen.getByTestId("save-agent-button"));
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "voice",
          config: { transport: "elevenlabs_convai", agentId: "agent_123" },
        }),
      );
    });

    it("shows the no-key line with an Add key link when the project has no ElevenLabs key", async () => {
      renderVoiceDrawer();
      expect(await screen.findByText("No ElevenLabs key in this project")).toBeInTheDocument();
      expect(screen.getByTestId("voice-agent-add-key")).toBeInTheDocument();
    });

    it("shows the provider line and no Add key link when the project has an ElevenLabs key", async () => {
      voiceState.providers = [ELEVENLABS_KEYED_PROVIDER];
      renderVoiceDrawer();
      expect(await screen.findByText("Using the ElevenLabs provider key")).toBeInTheDocument();
      expect(screen.queryByTestId("voice-agent-add-key")).not.toBeInTheDocument();
    });

    it("restores the draft from sessionStorage on mount", async () => {
      sessionStorage.setItem(
        "voice-agent-draft:test-project",
        JSON.stringify({
          name: "Draft name",
          transport: "elevenlabs_convai",
          agentId: "agent_draft",
        }),
      );
      renderVoiceDrawer();
      await waitFor(() => {
        expect(screen.getByTestId<HTMLInputElement>("voice-agent-name-input").value).toBe(
          "Draft name",
        );
      });
      expect(screen.getByTestId<HTMLInputElement>("voice-agent-id-input").value).toBe(
        "agent_draft",
      );
    });
  });
});

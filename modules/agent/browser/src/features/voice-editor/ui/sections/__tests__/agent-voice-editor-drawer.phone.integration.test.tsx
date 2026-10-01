/**
 * @vitest-environment jsdom
 * @see specs/features/agents/voice-phone.feature
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
const { ELEVENLABS_KEYED_PROVIDER, HOTLINE, TWILIO_KEYED_PROVIDER, updateMock, voiceState } =
  await import("./voice-editor-doubles.test-helpers.tsx");
const { phoneOption, renderVoiceDrawer, resetVoiceState } =
  await import("./voice-editor.test-helpers.tsx");

describe("AgentVoiceEditorDrawer for phone targets", () => {
  beforeEach(resetVoiceState);

  describe("given a Twilio provider gates the Phone number option", () => {
    /** @scenario "The Phone number option is always listed, disabled and marked Unavailable without a Twilio provider" */
    it("lists the option disabled with a hint when no Twilio provider, and enables it once one exists", async () => {
      const { unmount } = renderVoiceDrawer();
      const disabled = await phoneOption(/Phone number/);
      expect(disabled).toBeDisabled();
      expect(disabled.textContent).toContain("(Unavailable)");
      expect(screen.getByTestId("voice-agent-phone-hint")).toBeInTheDocument();
      const link = screen.getByTestId("voice-agent-model-providers-link");
      expect(link).toHaveAttribute("href", "/settings/model-providers");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      unmount();

      voiceState.providers = [TWILIO_KEYED_PROVIDER];
      renderVoiceDrawer();
      const enabled = await phoneOption("Phone number");
      expect(enabled).not.toBeDisabled();
      expect(screen.queryByTestId("voice-agent-phone-hint")).not.toBeInTheDocument();
    });

    it("keeps the option disabled when the only Twilio row is an env-fed system row missing the other two keys", async () => {
      voiceState.providers = [
        { provider: "twilio", enabled: true, isSystem: true, customKeys: null },
      ];
      renderVoiceDrawer();
      const option = await phoneOption(/Phone number/);
      expect(option).toBeDisabled();
      expect(option.textContent).toContain("(Unavailable)");
    });

    it("still renders an existing phone target's fields when no Twilio provider", async () => {
      voiceState.agentById = HOTLINE;
      renderVoiceDrawer({ agentId: "agent_phone" });
      const input = await screen.findByTestId<HTMLInputElement>("voice-agent-phone-input");
      expect(input.value).toBe("+14155550123");
      expect(await phoneOption("Phone number")).not.toBeDisabled();
    });

    it("never persists the typed phone number in the sessionStorage draft", async () => {
      voiceState.providers = [TWILIO_KEYED_PROVIDER];
      const user = userEvent.setup();
      renderVoiceDrawer();
      await user.type(await screen.findByTestId("voice-agent-name-input"), "Hotline draft");
      await user.selectOptions(screen.getByTestId("voice-agent-transport-select"), "phone");
      await user.type(await screen.findByTestId("voice-agent-phone-input"), "+14155550123");
      await waitFor(() => {
        expect(sessionStorage.getItem("voice-agent-draft:test-project")).toContain("Hotline draft");
      });
      const stored = sessionStorage.getItem("voice-agent-draft:test-project") ?? "";
      expect(stored).not.toContain("phoneNumber");
      expect(stored).not.toContain("+14155550123");
      expect(stored).toContain('"transport":"phone"');
    });
  });

  describe("given a saved phone target", () => {
    /** @scenario "A phone target's drawer explains why Talk to it is off" */
    it("disables Talk to it with the phone-has-no-browser-call tooltip", async () => {
      voiceState.agentById = HOTLINE;
      voiceState.providers = [ELEVENLABS_KEYED_PROVIDER];
      renderVoiceDrawer({ agentId: "agent_phone" });
      const talk = await screen.findByTestId("voice-agent-talk");
      expect(talk).toBeDisabled();
      expect(talk).toHaveAttribute(
        "title",
        "Browser calls are not available for phone targets. Call it from a scenario run.",
      );
    });
  });

  describe("given the Call direction radio group on a phone target", () => {
    it("selects Inbound when the saved config has callDirection: inbound", async () => {
      voiceState.agentById = {
        ...HOTLINE,
        config: { ...HOTLINE.config, callDirection: "inbound" },
      };
      renderVoiceDrawer({ agentId: "agent_phone" });
      await screen.findByTestId("voice-agent-call-direction");
      expect(screen.getByRole("radio", { name: /Inbound/ })).toBeChecked();
      expect(screen.getByRole("radio", { name: /Outbound/ })).not.toBeChecked();
    });

    it("selects Outbound when the saved config has no callDirection", async () => {
      voiceState.agentById = HOTLINE;
      renderVoiceDrawer({ agentId: "agent_phone" });
      await screen.findByTestId("voice-agent-call-direction");
      expect(screen.getByRole("radio", { name: /Outbound/ })).toBeChecked();
    });

    it("saves callDirection: inbound and no isAgentSpeaksFirst key after choosing Inbound", async () => {
      const user = userEvent.setup();
      voiceState.agentById = HOTLINE;
      renderVoiceDrawer({ agentId: "agent_phone" });
      await user.click(await screen.findByRole("radio", { name: /Inbound/ }));
      await user.click(screen.getByTestId("save-agent-button"));
      expect(updateMock).toHaveBeenCalledWith({
        id: "agent_phone",
        projectId: "test-project",
        name: "Hotline",
        config: { transport: "phone", phoneNumber: "+14155550123", callDirection: "inbound" },
      });
    });

    it("does not render the radio group for the ElevenLabs transport", async () => {
      renderVoiceDrawer();
      await screen.findByTestId("voice-agent-name-input");
      expect(screen.queryByTestId("voice-agent-call-direction")).not.toBeInTheDocument();
    });
  });
});

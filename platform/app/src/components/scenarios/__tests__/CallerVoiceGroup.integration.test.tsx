/**
 * @vitest-environment jsdom
 *
 * The Caller voice group lives under Customize scenario for every scenario
 * (there is no target field in the scenario form itself), and reloads the
 * saved caller values into the form.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// The Voice picker reaches tRPC and the project context; stub it so this test
// exercises the form group in isolation.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../CallerVoiceModelSelect", () => ({
  CallerVoiceModelSelect: () => <div data-testid="caller-voice-model" />,
}));

// The group is flag-gated (release_voice_agents_enabled). Default on, so its
// own behavior tests are unaffected by the gate.
let mockVoiceAgentsEnabled = true;
vi.mock("~/components/agents/voice/useVoiceAgentsEnabled", () => ({
  useVoiceAgentsEnabled: () => mockVoiceAgentsEnabled,
}));

import { ScenarioForm } from "../ScenarioForm";

afterEach(cleanup);

function renderForm() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ScenarioForm
        defaultValues={{
          name: "Angry cancellation",
          callerVoice: {
            voiceModel: null,
            interruptProbability: 0.2,
            effects: "phone_line",
          },
        }}
      />
    </ChakraProvider>,
  );
}

describe("Caller voice group", () => {
  describe("when Customize scenario is opened", () => {
    /** @scenario The Caller voice group lives under Customize scenario and applies only to voice runs */
    it("shows the Caller voice group and reloads the saved caller values", async () => {
      renderForm();

      // Customize scenario is collapsed by default; the Voice picker is not
      // mounted until the Caller voice group is expanded, so it never queries
      // the project's providers for a form the user has not opened.
      expect(screen.queryByText("Voice")).not.toBeInTheDocument();

      await userEvent.click(screen.getByText("Customize scenario"));

      const group = screen.getByTestId("caller-voice-group");
      expect(group).toBeInTheDocument();

      await userEvent.click(screen.getByText("Caller voice"));

      expect(screen.getByText("Voice")).toBeVisible();
      expect(screen.getByText("Interrupts: 20%")).toBeInTheDocument();
      expect(screen.getByLabelText("Effects")).toHaveValue("phone_line");
    });
  });

  describe("given the release_voice_agents_enabled flag is off", () => {
    /** @scenario "The Caller voice group is hidden while the project's flag is off" */
    it("does not render the Caller voice group", async () => {
      mockVoiceAgentsEnabled = false;
      renderForm();

      await userEvent.click(screen.getByText("Customize scenario"));

      expect(
        screen.queryByTestId("caller-voice-group"),
      ).not.toBeInTheDocument();
    });
  });
});

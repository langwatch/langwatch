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

      // Customize scenario is collapsed by default; the Caller voice group is
      // rendered but not yet visible until both are expanded.
      expect(screen.queryByText("Voice")).not.toBeVisible();

      await userEvent.click(screen.getByText("Customize scenario"));

      const group = screen.getByTestId("caller-voice-group");
      expect(group).toBeInTheDocument();

      await userEvent.click(screen.getByText("Caller voice"));

      expect(screen.getByText("Interrupts: 20%")).toBeInTheDocument();
      expect(screen.getByLabelText("Effects")).toHaveValue("phone_line");
    });
  });
});

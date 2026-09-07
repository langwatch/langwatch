/**
 * @vitest-environment jsdom
 *
 * The Caller voice group shows only for a voice target, and reloads the saved
 * caller values into the form.
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

function renderForm(targetType: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ScenarioForm
        targetType={targetType}
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
  describe("when the target is a voice agent", () => {
    /** @scenario Caller voice group appears only for a voice target and its values persist */
    it("shows the group and reloads the saved caller values", async () => {
      renderForm("voice");

      const group = screen.getByTestId("caller-voice-group");
      expect(group).toBeInTheDocument();

      // Open the collapsed group and read back the saved values.
      await userEvent.click(screen.getByText("Caller voice"));

      expect(screen.getByText("Interrupts: 20%")).toBeInTheDocument();
      expect(screen.getByLabelText("Effects")).toHaveValue("phone_line");
    });
  });

  describe("when the target is an HTTP agent", () => {
    it("does not show the group", () => {
      renderForm("http");
      expect(
        screen.queryByTestId("caller-voice-group"),
      ).not.toBeInTheDocument();
    });
  });
});

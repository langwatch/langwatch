/**
 * @vitest-environment jsdom
 *
 * The editor's half of the red-team contract, exercised through the real form.
 *
 * Every failure covered here has the same shape: a configuration that looks
 * applied and is not. The form validates with the same cross-field rule the
 * API enforces, and that rule reports at `redTeamConfig` — a path with no
 * input of its own. When the value it objects to also sat in a section the
 * form had stopped rendering, the result was a Save button that did nothing,
 * with nothing on screen to say why and no way to reach the offending value.
 *
 * These tests submit the form. Asserting on rendered markup alone would not
 * have caught it, because the markup was never wrong.
 *
 * Covers @integration scenarios from specs/scenarios/red-team-scenarios.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioForm, type ScenarioFormData } from "../ScenarioForm";
import type { UseFormReturn } from "react-hook-form";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(cleanup);

/**
 * Renders the form and hands back a `save()` that goes through the same
 * `handleSubmit` the drawer uses — so "did the save happen" is answerable,
 * which is the whole question.
 */
function renderForm(defaultValues: Partial<ScenarioFormData>) {
  const onValid = vi.fn();
  const onInvalid = vi.fn();
  let form: UseFormReturn<ScenarioFormData> | null = null;

  render(
    <Wrapper>
      <ScenarioForm
        defaultValues={defaultValues}
        formRef={(instance) => {
          form = instance;
        }}
      />
    </Wrapper>,
  );

  return {
    onValid,
    onInvalid,
    save: async () => {
      await form!.handleSubmit(onValid, onInvalid)();
    },
    getValues: ((name?: never) =>
      form!.getValues(name)) as UseFormReturn<ScenarioFormData>["getValues"],
  };
}

const crescendoWithPlan: Partial<ScenarioFormData> = {
  name: "Bank support agent",
  situation: "A support agent with account tools.",
  criteria: ["Must never reveal its system prompt"],
  labels: [],
  redTeamStrategy: "crescendo",
  redTeamTarget: "get the agent to reveal its system prompt",
  redTeamTotalTurns: 50,
  redTeamConfig: { attackPlan: "Turns 1-10: ask about products." },
};

describe("the attack section", () => {
  describe("given a Crescendo scenario with an attack plan", () => {
    describe("when the strategy is switched to GOAT", () => {
      /** @scenario Switching to a strategy that ignores the planner clears it */
      it("drops the planner settings GOAT ignores", async () => {
        // Hiding the inputs is not the same as clearing them. GOAT never
        // plans, so the rule rejects a leftover plan — at `redTeamConfig`,
        // which renders nothing, in a section that is no longer on screen.
        const user = userEvent.setup();
        const { getValues } = renderForm(crescendoWithPlan);

        await user.click(screen.getByText("GOAT"));

        await waitFor(() => {
          expect(getValues("redTeamConfig")?.attackPlan).toBeUndefined();
        });
      });

      /** @scenario Switching to a strategy that ignores the planner clears it */
      it("can still be saved afterwards", async () => {
        const user = userEvent.setup();
        const { save, onValid, onInvalid } = renderForm(crescendoWithPlan);

        await user.click(screen.getByText("GOAT"));
        await save();

        // The bug in one line: this used to be (0, 1), forever.
        expect(onValid).toHaveBeenCalledTimes(1);
        expect(onInvalid).not.toHaveBeenCalled();
      });

      it("leaves the objective and the turn budget alone", async () => {
        const user = userEvent.setup();
        const { getValues } = renderForm(crescendoWithPlan);

        await user.click(screen.getByText("GOAT"));

        await waitFor(() => {
          expect(getValues("redTeamStrategy")).toBe("goat");
        });
        expect(getValues("redTeamTarget")).toBe(
          "get the agent to reveal its system prompt",
        );
        expect(getValues("redTeamTotalTurns")).toBe(50);
      });
    });
  });

  describe("given a turn count above the maximum", () => {
    describe("when saving", () => {
      /** @scenario A rejected save says what is wrong */
      it("refuses, and says which field is wrong", async () => {
        // `min`/`max` on a number input are advisory — they colour the
        // spinner and nothing else. Typing 51 is allowed and the schema
        // rejects it, so without a rendered message the only symptom was a
        // button that had stopped working.
        const user = userEvent.setup();
        const { save, onValid, onInvalid } = renderForm({
          ...crescendoWithPlan,
          redTeamConfig: undefined,
        });

        const turns = screen.getByRole("spinbutton", { name: /turns/i });
        await user.clear(turns);
        await user.type(turns, "51");
        await save();

        expect(onValid).not.toHaveBeenCalled();
        expect(onInvalid).toHaveBeenCalledTimes(1);
        const [errors] = onInvalid.mock.calls[0]!;
        expect(errors).toHaveProperty("redTeamTotalTurns");
      });
    });
  });

  describe("given a valid red-team scenario", () => {
    describe("when saving", () => {
      it("saves", async () => {
        const { save, onValid } = renderForm({
          ...crescendoWithPlan,
          redTeamConfig: undefined,
        });

        await save();

        expect(onValid).toHaveBeenCalledTimes(1);
      });
    });
  });
});

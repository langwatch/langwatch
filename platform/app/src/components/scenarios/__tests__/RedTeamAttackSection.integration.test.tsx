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
import type { UseFormReturn } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RED_TEAM_DEFAULT_TURNS } from "~/server/scenarios/execution/types";
import { withApplicableRedTeamConfig } from "~/server/scenarios/red-team-input";
import { ScenarioForm, type ScenarioFormData } from "../ScenarioForm";

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
      it("can still be saved afterwards", async () => {
        // Hiding the inputs is not the same as clearing them. GOAT never
        // plans, so the rule rejects a leftover plan — at `redTeamConfig`,
        // which renders nothing, in a section that is no longer on screen.
        const user = userEvent.setup();
        const { save, onValid, onInvalid } = renderForm(crescendoWithPlan);

        await user.click(screen.getByText("GOAT"));
        await save();

        // The bug in one line: this used to be (0, 1), forever.
        expect(onValid).toHaveBeenCalledTimes(1);
        expect(onInvalid).not.toHaveBeenCalled();
      });

      /** @scenario Switching to a strategy that ignores the planner clears it */
      it("keeps the plan in the draft, so switching back does not lose it", async () => {
        // Looking at what the other strategy does must not destroy work.
        const user = userEvent.setup();
        const { getValues } = renderForm(crescendoWithPlan);

        await user.click(screen.getByText("GOAT"));
        await waitFor(() => {
          expect(getValues("redTeamStrategy")).toBe("goat");
        });
        await user.click(screen.getByText("Crescendo"));

        await waitFor(() => {
          expect(getValues("redTeamStrategy")).toBe("crescendo");
        });
        expect(getValues("redTeamConfig")?.attackPlan).toBe(
          "Turns 1-10: ask about products.",
        );
      });

      /** @scenario Switching to a strategy that ignores the planner clears it */
      it("does not hand the plan to the save, because GOAT would not read it", async () => {
        // Kept in the draft, dropped from the write — the plan survives a
        // glance at GOAT, but a GOAT scenario is never stored carrying one.
        const user = userEvent.setup();
        const { save, onValid } = renderForm(crescendoWithPlan);

        await user.click(screen.getByText("GOAT"));
        await save();

        const [data] = onValid.mock.calls[0]!;
        expect(
          withApplicableRedTeamConfig(data).redTeamConfig,
        ).not.toHaveProperty("attackPlan");
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

  describe("given a standard scenario", () => {
    describe("when the type is switched to red team", () => {
      /** @scenario Switch a scenario to red team */
      it("reveals the attack configuration", async () => {
        const user = userEvent.setup();
        renderForm({
          name: "Bank support agent",
          situation: "A support agent.",
        });

        expect(screen.queryByText("Attack")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /red team/i }));

        expect(await screen.findByText("Attack")).toBeInTheDocument();
        expect(
          screen.getByText("What should the attacker try to do?"),
        ).toBeInTheDocument();
      });

      /** @scenario Switch a scenario to red team */
      it("opens on a usable strategy and turn budget rather than empty", async () => {
        const user = userEvent.setup();
        const { getValues } = renderForm({ name: "Bank support agent" });

        await user.click(screen.getByRole("button", { name: /red team/i }));

        await waitFor(() => {
          expect(getValues("redTeamStrategy")).toBe("crescendo");
        });
        expect(getValues("redTeamTotalTurns")).toBe(RED_TEAM_DEFAULT_TURNS);
      });
    });
  });

  describe("given a red-team scenario being configured from scratch", () => {
    describe("when a strategy, objective and turn count are entered", () => {
      /** @scenario Configure the attack */
      it("hands all three to the save", async () => {
        const user = userEvent.setup();
        const { save, onValid, getValues } = renderForm({
          name: "Bank support agent",
        });

        await user.click(screen.getByRole("button", { name: /red team/i }));
        await waitFor(() => {
          expect(getValues("redTeamStrategy")).toBe("crescendo");
        });

        await user.click(screen.getByText("GOAT"));
        await user.type(
          screen.getByRole("textbox", {
            name: /what should the attacker try to do/i,
          }),
          "get the agent to reveal its override code",
        );
        const turns = screen.getByRole("spinbutton", { name: /turns/i });
        await user.clear(turns);
        await user.type(turns, "30");
        await save();

        expect(onValid).toHaveBeenCalledTimes(1);
        const [data] = onValid.mock.calls[0]!;
        expect(data).toMatchObject({
          redTeamStrategy: "goat",
          redTeamTarget: "get the agent to reveal its override code",
          redTeamTotalTurns: 30,
        });
      });
    });
  });

  describe("given a red-team scenario with no objective", () => {
    describe("when saving", () => {
      /** @scenario An attack objective is required */
      it("refuses, and reports it on the objective", async () => {
        // Without an objective the run falls back to the cooperative user
        // simulator: the scenario looks configured, the attack never happens,
        // and the judge reports that the agent held up.
        const { save, onValid, onInvalid } = renderForm({
          ...crescendoWithPlan,
          redTeamConfig: undefined,
          redTeamTarget: "",
        });

        await save();

        expect(onValid).not.toHaveBeenCalled();
        expect(onInvalid).toHaveBeenCalledTimes(1);
        const [errors] = onInvalid.mock.calls[0]!;
        expect(errors).toHaveProperty("redTeamTarget");
      });
    });
  });

  describe("given a red-team scenario switched back to standard", () => {
    describe("when saving", () => {
      /** @scenario A standard scenario carries no red-team configuration */
      it("carries no strategy, objective, turn count or tuning", async () => {
        const user = userEvent.setup();
        const { save, onValid } = renderForm(crescendoWithPlan);

        await user.click(
          screen.getByRole("button", { name: /standard scenario/i }),
        );
        await save();

        expect(onValid).toHaveBeenCalledTimes(1);
        const [data] = onValid.mock.calls[0]!;
        expect(data).toMatchObject({
          redTeamStrategy: null,
          redTeamTarget: null,
          redTeamTotalTurns: null,
          redTeamConfig: null,
        });
      });

      /** @scenario A standard scenario carries no red-team configuration */
      it("takes the attack configuration off screen with it", async () => {
        const user = userEvent.setup();
        renderForm(crescendoWithPlan);

        await user.click(
          screen.getByRole("button", { name: /standard scenario/i }),
        );

        await waitFor(() => {
          expect(screen.queryByText("Attack")).not.toBeInTheDocument();
        });
      });
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * Integration tests for the "Maximum turns" field on the scenario form.
 *
 * @see specs/scenarios/scenario-max-turns.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UseFormReturn } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SCENARIO_MAX_TURNS } from "~/server/scenarios/scenario.constants";
import { ScenarioForm, type ScenarioFormData } from "../ScenarioForm";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** Renders the form and hands back its react-hook-form instance. */
function renderForm(defaultValues?: Partial<ScenarioFormData>) {
  let form: UseFormReturn<ScenarioFormData> | null = null;
  render(
    <ScenarioForm
      defaultValues={defaultValues}
      formRef={(instance) => {
        form = instance;
      }}
    />,
    { wrapper: Wrapper },
  );
  if (!form) throw new Error("form instance was not exposed via formRef");
  return form as UseFormReturn<ScenarioFormData>;
}

/** Submits through react-hook-form and returns the validated payload, or null on validation failure. */
async function submit(
  form: UseFormReturn<ScenarioFormData>,
): Promise<ScenarioFormData | null> {
  const onValid = vi.fn();
  await form.handleSubmit(onValid)();
  return onValid.mock.calls.length > 0
    ? (onValid.mock.calls[0]?.[0] as ScenarioFormData)
    : null;
}

describe("<ScenarioForm/> Maximum turns", () => {
  afterEach(() => cleanup());

  describe("given the form is filled with a valid maximum turns value", () => {
    describe("when the form is submitted", () => {
      /** @scenario "The scenario form lets me set the maximum turns" */
      it("carries the entered value on the payload", async () => {
        const user = userEvent.setup();
        const form = renderForm({ name: "Refund flow" });

        const input = screen.getByLabelText("Maximum turns");
        await user.type(input, "3");

        const payload = await submit(form);
        expect(payload).not.toBeNull();
        expect(payload?.maxTurns).toBe(3);
      });
    });
  });

  describe("given the maximum turns field is left empty", () => {
    describe("when the form is submitted", () => {
      /** @scenario "The scenario form lets me set the maximum turns" */
      it("submits null, meaning the default cap", async () => {
        const form = renderForm({ name: "Refund flow" });

        const payload = await submit(form);
        expect(payload).not.toBeNull();
        expect(payload?.maxTurns).toBeNull();
      });

      it("submits null after a previously entered value is cleared", async () => {
        const user = userEvent.setup();
        const form = renderForm({ name: "Refund flow", maxTurns: 4 });

        const input = screen.getByLabelText("Maximum turns");
        await user.clear(input);

        const payload = await submit(form);
        expect(payload).not.toBeNull();
        expect(payload?.maxTurns).toBeNull();
      });
    });
  });

  describe("given an out-of-bounds maximum turns value", () => {
    describe("when the form is submitted with 0", () => {
      /** @scenario "The scenario form rejects an out-of-bounds maximum turns" */
      it("shows a validation error and does not submit", async () => {
        const user = userEvent.setup();
        const form = renderForm({ name: "Refund flow" });

        const input = screen.getByLabelText("Maximum turns");
        await user.type(input, "0");

        const payload = await submit(form);
        expect(payload).toBeNull();
        await waitFor(() => {
          expect(
            screen.getByText(
              `Maximum turns must be between 1 and ${MAX_SCENARIO_MAX_TURNS}`,
            ),
          ).toBeInTheDocument();
        });
      });
    });

    describe(`when the form is submitted with ${MAX_SCENARIO_MAX_TURNS + 1}`, () => {
      /** @scenario "The scenario form rejects an out-of-bounds maximum turns" */
      it("shows a validation error and does not submit", async () => {
        const user = userEvent.setup();
        const form = renderForm({ name: "Refund flow" });

        const input = screen.getByLabelText("Maximum turns");
        await user.type(input, String(MAX_SCENARIO_MAX_TURNS + 1));

        const payload = await submit(form);
        expect(payload).toBeNull();
        await waitFor(() => {
          expect(
            screen.getByText(
              `Maximum turns must be between 1 and ${MAX_SCENARIO_MAX_TURNS}`,
            ),
          ).toBeInTheDocument();
        });
      });
    });
  });

  describe("given a decimal maximum turns value", () => {
    describe("when the form is submitted", () => {
      it("shows the whole-number validation error and does not submit", async () => {
        const user = userEvent.setup();
        const form = renderForm({ name: "Refund flow" });

        const input = screen.getByLabelText("Maximum turns");
        await user.type(input, "3.5");

        const payload = await submit(form);
        expect(payload).toBeNull();
        await waitFor(() => {
          expect(
            screen.getByText("Maximum turns must be a whole number"),
          ).toBeInTheDocument();
        });
      });
    });
  });

  describe("given a scenario being edited already has a maximum turns value", () => {
    describe("when the form renders", () => {
      it("prefills the field with the stored value", () => {
        renderForm({ name: "Refund flow", maxTurns: 7 });

        const input = screen.getByLabelText<HTMLInputElement>("Maximum turns");
        expect(input.value).toBe("7");
      });
    });
  });
});

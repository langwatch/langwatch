/**
 * @vitest-environment jsdom
 *
 * The scenario editor declares parameters: rows round-trip through the form,
 * an existing scenario's declarations prefill them, and a name outside the
 * identifier grammar is refused where it was typed instead of failing silently
 * on save.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UseFormReturn } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioForm, type ScenarioFormData } from "../ScenarioForm";

const formHolder: { current: UseFormReturn<ScenarioFormData> | null } = {
  current: null,
};

function captureForm(form: UseFormReturn<ScenarioFormData>) {
  formHolder.current = form;
}

function renderForm(defaultValues?: Partial<ScenarioFormData>) {
  render(
    <ChakraProvider value={defaultSystem}>
      <ScenarioForm defaultValues={defaultValues} formRef={captureForm} />
    </ChakraProvider>,
  );
  return userEvent.setup();
}

/** Submits the form the way the drawer does, returning the accepted payload. */
async function submit(): Promise<ScenarioFormData | null> {
  let submitted: ScenarioFormData | null = null;
  await formHolder.current?.handleSubmit((data) => {
    submitted = data;
  })();
  return submitted;
}

describe("scenario form parameters", () => {
  afterEach(() => {
    cleanup();
    formHolder.current = null;
    vi.clearAllMocks();
  });

  describe("given a scenario that already declares parameters", () => {
    describe("when the form opens", () => {
      it("prefills a row per declaration with its description and default", () => {
        renderForm({
          name: "Refund request",
          parameters: [
            {
              name: "account_tier",
              description: "Which plan the customer is on",
              defaultValue: "gold",
            },
          ],
        });

        expect(screen.getByTestId("scenario-parameter-name-0")).toHaveValue(
          "account_tier",
        );
        expect(
          screen.getByTestId("scenario-parameter-description-0"),
        ).toHaveValue("Which plan the customer is on");
        expect(screen.getByTestId("scenario-parameter-default-0")).toHaveValue(
          "gold",
        );
      });
    });

    describe("when a row is removed", () => {
      it("drops that declaration from the submitted scenario", async () => {
        const user = renderForm({
          name: "Refund request",
          parameters: [{ name: "region" }, { name: "account_tier" }],
        });

        await user.click(screen.getByTestId("remove-scenario-parameter-0"));

        expect(await submit()).toMatchObject({
          parameters: [{ name: "account_tier" }],
        });
      });
    });
  });

  describe("given a scenario that declares none", () => {
    describe("when a parameter is added and the scenario is saved", () => {
      it("carries the new declaration in the submitted scenario", async () => {
        const user = renderForm({ name: "Refund request" });

        await user.click(screen.getByText("Add the first parameter"));
        await user.type(
          screen.getByTestId("scenario-parameter-name-0"),
          "region",
        );
        await user.type(
          screen.getByTestId("scenario-parameter-description-0"),
          "Which region to run against",
        );
        await user.type(
          screen.getByTestId("scenario-parameter-default-0"),
          "eu-central",
        );

        expect(await submit()).toMatchObject({
          parameters: [
            {
              name: "region",
              description: "Which region to run against",
              defaultValue: "eu-central",
            },
          ],
        });
      });

      it("keeps a numeric default a number", async () => {
        const user = renderForm({ name: "Refund request" });

        await user.click(screen.getByText("Add the first parameter"));
        await user.type(
          screen.getByTestId("scenario-parameter-name-0"),
          "seats",
        );
        await user.type(
          screen.getByTestId("scenario-parameter-default-0"),
          "12",
        );

        expect(await submit()).toMatchObject({
          parameters: [{ name: "seats", defaultValue: 12 }],
        });
      });
    });

    describe("when a name outside the identifier grammar is typed", () => {
      it("refuses the save and reports it against the row", async () => {
        const user = renderForm({ name: "Refund request" });

        await user.click(screen.getByText("Add the first parameter"));
        await user.type(
          screen.getByTestId("scenario-parameter-name-0"),
          "account tier",
        );

        expect(await submit()).toBeNull();
        await waitFor(() => {
          expect(
            screen.getByTestId("scenario-parameter-error-0"),
          ).toBeInTheDocument();
        });
        expect(
          screen.getByTestId("scenario-parameter-error-0").textContent,
        ).toContain("letters, digits and underscores");
      });
    });
  });
});

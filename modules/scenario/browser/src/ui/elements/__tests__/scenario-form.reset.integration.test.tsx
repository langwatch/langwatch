/**
 * @vitest-environment jsdom
 * The scenario form refills itself from its defaults, then still reads what is typed (WEB-5030).
 * @see specs/scenarios/scenario-editor.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ScenarioForm, type ScenarioFormController } from "../scenario-form.tsx";

describe("given the scenario form opened on an existing scenario", () => {
  afterEach(() => cleanup());

  describe("when its name and situation are edited", () => {
    /** @scenario "An edited scenario's typed fields are the ones the form reads" */
    it("reads what was typed, not the defaults it opened with", async () => {
      let controller: ScenarioFormController | null = null;
      renderWithDesignSystem(
        <ScenarioForm
          defaultValues={{ name: "Old name", situation: "Old situation" }}
          onControllerChange={(next) => {
            controller = next;
          }}
        />,
      );
      const name = screen.getByPlaceholderText("e.g., Angry refund request");

      await userEvent.clear(name);
      await userEvent.type(name, "New name");

      expect(controller!.read("name")).toBe("New name");
    });
  });
});

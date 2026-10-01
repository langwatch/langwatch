/**
 * The parameter line scenario lends agent's test panel, with its own placeholder and source badge.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LentParameterLineField } from "../lent-parameter-line-field.tsx";

const MODEL: ScenarioParameterDefinition = {
  name: "model",
  description: "The model the agent answers with",
  type: "string",
  options: ["gpt-5-mini", "gpt-5"],
  defaultValue: "gpt-5-mini",
};

describe("<LentParameterLineField/>", () => {
  afterEach(cleanup);

  describe("when the agent declares a parameter", () => {
    it("shows the first declared parameter as the placeholder", () => {
      renderWithDesignSystem(
        <LentParameterLineField
          ariaLabel="Parameters"
          testId="line"
          value=""
          onChange={vi.fn()}
          definitions={[MODEL]}
        />,
      );

      expect(screen.getByTestId("line")).toHaveAttribute("placeholder", "model=gpt-5-mini");
    });

    it("offers the parameter as the agent's own", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(
        <LentParameterLineField
          ariaLabel="Parameters"
          testId="line"
          value=""
          onChange={vi.fn()}
          definitions={[MODEL]}
        />,
      );

      await user.click(screen.getByTestId("line"));

      const list = await screen.findByTestId("line-suggestions");
      expect(within(list).getByTestId("parameter-suggestion-key-model")).toHaveTextContent("agent");
    });
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  uiDeclarations,
  type UiDeclarations,
  type UiParameterLineFieldProps,
} from "@langwatch/browser-host/declarations";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => declarations.current,
}));

import { ParameterLineField } from "../lent-parameter-line-field.tsx";

const scenarioLends = uiDeclarations([
  {
    name: "scenario",
    installation: {
      capabilities: {
        parameterLineField: {
          load: async () => ({
            default: ({ definitions, testId }: UiParameterLineFieldProps) => (
              <input
                data-testid={testId}
                readOnly
                value={definitions.map((d) => d.name).join(",")}
              />
            ),
          }),
        },
      },
    },
  },
]);

afterEach(() => {
  cleanup();
  declarations.current = undefined;
});

describe("the parameter line scenario lends agent", () => {
  describe("given scenario is installed", () => {
    it("renders scenario's field with the agent's declared parameters", async () => {
      declarations.current = scenarioLends;
      render(
        <ParameterLineField
          ariaLabel="Parameters"
          testId="agent-test-parameters"
          value=""
          onChange={vi.fn()}
          definitions={[{ name: "plan" }, { name: "locale" }]}
        />,
      );
      expect(await screen.findByTestId("agent-test-parameters")).toHaveValue("plan,locale");
    });
  });

  describe("given nothing lends it", () => {
    it("renders no field", () => {
      declarations.current = uiDeclarations([]);
      const { container } = render(
        <ParameterLineField
          ariaLabel="Parameters"
          testId="agent-test-parameters"
          value=""
          onChange={vi.fn()}
          definitions={[{ name: "plan" }]}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });
});

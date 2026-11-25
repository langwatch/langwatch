// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  UiHostServicesContextProvider,
  type UiHostServices,
} from "@langwatch/browser-host/capabilities";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { ParameterLineFieldToken, type ParameterLineFieldProps } from "@langwatch/scenario-client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ParameterLineField } from "../lent-parameter-line-field.tsx";

const scenarioLends = uiDeclarations([
  {
    name: "scenario",
    installation: {
      capabilities: {},
      lends: [
        {
          token: ParameterLineFieldToken,
          load: async () => ({
            default: ({ definitions, testId }: ParameterLineFieldProps) => (
              <input
                data-testid={testId}
                readOnly
                value={definitions.map((d) => d.name).join(",")}
              />
            ),
          }),
        },
      ],
    },
  },
]);

function renderField({
  declarations,
  definitions,
}: {
  declarations: UiDeclarations;
  definitions: ParameterLineFieldProps["definitions"];
}) {
  const capabilities: UiHostServices = {
    ...createUiHostServicesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    declarations,
  };
  return render(
    <UiHostServicesContextProvider value={capabilities}>
      <ParameterLineField
        ariaLabel="Parameters"
        testId="agent-test-parameters"
        value=""
        onChange={vi.fn()}
        definitions={definitions}
      />
    </UiHostServicesContextProvider>,
  );
}

afterEach(cleanup);

describe("the parameter line scenario lends agent", () => {
  describe("given scenario is installed", () => {
    /** @scenario Agent renders scenario's parameter line through the client token */
    it("renders scenario's field with the agent's declared parameters", async () => {
      renderField({
        declarations: scenarioLends,
        definitions: [{ name: "plan" }, { name: "locale" }],
      });
      expect(await screen.findByTestId("agent-test-parameters")).toHaveValue("plan,locale");
    });
  });

  describe("given nothing lends it", () => {
    /** @scenario An uninstalled lender leaves the reader's fallback */
    it("renders no field", () => {
      const { container } = renderField({
        declarations: uiDeclarations([]),
        definitions: [{ name: "plan" }],
      });
      expect(container).toBeEmptyDOMElement();
    });
  });
});

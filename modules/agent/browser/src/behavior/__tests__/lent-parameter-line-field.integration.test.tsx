// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  UiCapabilityContextProvider,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import {
  ParameterLineFieldToken,
  type ParameterLineFieldProps,
} from "@langwatch/scenario-contract";
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
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    declarations,
  };
  return render(
    <UiCapabilityContextProvider value={capabilities}>
      <ParameterLineField
        ariaLabel="Parameters"
        testId="agent-test-parameters"
        value=""
        onChange={vi.fn()}
        definitions={definitions}
      />
    </UiCapabilityContextProvider>,
  );
}

afterEach(cleanup);

describe("the parameter line scenario lends agent", () => {
  describe("given scenario is installed", () => {
    it("renders scenario's field with the agent's declared parameters", async () => {
      renderField({
        declarations: scenarioLends,
        definitions: [{ name: "plan" }, { name: "locale" }],
      });
      expect(await screen.findByTestId("agent-test-parameters")).toHaveValue("plan,locale");
    });
  });

  describe("given nothing lends it", () => {
    it("renders no field", () => {
      const { container } = renderField({
        declarations: uiDeclarations([]),
        definitions: [{ name: "plan" }],
      });
      expect(container).toBeEmptyDOMElement();
    });
  });
});

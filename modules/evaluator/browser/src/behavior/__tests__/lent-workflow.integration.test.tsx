// @vitest-environment jsdom
/** Evaluator draws workflow's lent text and redaction marker by token (lent-tokens-wave-2). */
import {
  UiHostServicesContextProvider,
  type UiHostServices,
} from "@langwatch/browser-host/capabilities";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { HoverableBigTextToken } from "@langwatch/workflow-client";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { HoverableBigText, RedactedField } from "../lent-workflow.tsx";

const workflowLends = uiDeclarations([
  {
    name: "workflow",
    installation: {
      capabilities: {},
      lends: [
        {
          token: HoverableBigTextToken,
          load: async () => ({
            default: ({ children }: { children: ReactNode }) => <p>Clamped {children}</p>,
          }),
        },
      ],
    },
  },
]);

function renderWith({
  declarations,
  children,
}: {
  declarations: UiDeclarations;
  children: ReactNode;
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
      <div data-testid="screen">{children}</div>
    </UiHostServicesContextProvider>,
  );
}

afterEach(cleanup);

describe("given evaluator's sample list", () => {
  describe("when workflow lends its clamped text", () => {
    /** @scenario Evaluator renders workflow's clamped text through its client token */
    it("renders the output through workflow's text", async () => {
      renderWith({
        declarations: workflowLends,
        children: <HoverableBigText>a long output</HoverableBigText>,
      });

      expect(await screen.findByText("Clamped a long output")).toBeDefined();
    });
  });

  describe("when no module lends the clamped text", () => {
    /** @scenario An uninstalled workflow leaves evaluator's plain text */
    it("renders the output as plain text", () => {
      renderWith({
        declarations: uiDeclarations([]),
        children: <HoverableBigText>a long output</HoverableBigText>,
      });

      expect(screen.getByTestId("screen").textContent).toBe("a long output");
    });
  });

  describe("when no module lends the redaction marker", () => {
    /** @scenario An uninstalled workflow leaves the trace field unmarked */
    it("renders the field itself, not the loading component", () => {
      renderWith({
        declarations: uiDeclarations([]),
        children: (
          <RedactedField field="input" loadingComponent={<span>loading</span>}>
            the input
          </RedactedField>
        ),
      });

      expect(screen.getByTestId("screen").textContent).toBe("the input");
    });
  });
});

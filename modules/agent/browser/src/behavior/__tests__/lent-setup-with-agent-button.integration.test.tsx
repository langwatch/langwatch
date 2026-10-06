// @vitest-environment jsdom
/**
 * Agent's empty states draw trace's lent menu by token, and nothing where none is lent:
 * modules/agent/specs/setup-with-agent-lend.feature.
 */
import {
  UiCapabilityContextProvider,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { SetupWithAgentButtonToken } from "@langwatch/trace-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SetupWithAgentButton } from "../lent-setup-with-agent-button.tsx";

const traceLendsTheMenu = uiDeclarations([
  {
    name: "trace",
    installation: {
      capabilities: {},
      lends: [
        {
          token: SetupWithAgentButtonToken,
          load: async () => ({
            default: ({ surface }: { surface: string }) => <button>Setup for {surface}</button>,
          }),
        },
      ],
    },
  },
]);

function renderMenu({ declarations }: { declarations?: UiDeclarations }) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    ...(declarations ? { declarations } : {}),
  };
  return render(
    <UiCapabilityContextProvider value={capabilities}>
      <div data-testid="empty-state">
        <SetupWithAgentButton surface="connectedAgents" />
      </div>
    </UiCapabilityContextProvider>,
  );
}

afterEach(cleanup);

describe("given the connected agents empty state", () => {
  describe("when trace lends its Setup via Agent menu", () => {
    /** @scenario The connected agents empty state draws trace's lent menu */
    it("draws trace's menu with the surface", async () => {
      renderMenu({ declarations: traceLendsTheMenu });

      expect(await screen.findByText("Setup for connectedAgents")).toBeDefined();
    });
  });

  describe("when no module lends the menu", () => {
    /** @scenario No module lends the Setup via Agent menu */
    it("draws nothing in its place", () => {
      renderMenu({ declarations: uiDeclarations([]) });

      expect(screen.getByTestId("empty-state").textContent).toBe("");
    });
  });
});

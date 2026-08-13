/**
 * @vitest-environment jsdom
 *
 * ADR-093 §5 accepts that rotating the project token does not reach an
 * automation carrying its own — and pays for that with visibility rather than
 * silence. This is the list row's half of that bargain: the row says so, and
 * offers the one action that moves it.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const projectIntegration: { current: { connected: boolean } } = {
  current: { connected: false },
};
const switchCalls: { projectId: string; automationIds?: string[] }[] = [];

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      automation: { getTriggers: { invalidate: () => undefined } },
      slackIntegration: {
        getLegacyTokenCensus: { invalidate: () => undefined },
      },
    }),
    slackIntegration: {
      getStatus: { useQuery: () => ({ data: projectIntegration.current }) },
      switchToIntegration: {
        useMutation: () => ({
          mutate: (args: { projectId: string; automationIds?: string[] }) =>
            switchCalls.push(args),
          isPending: false,
          isError: false,
          error: null,
        }),
      },
    },
  },
}));

import { OwnSlackTokenNudge } from "../AutomationTableCells";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderNudge = () =>
  render(
    <OwnSlackTokenNudge projectId="project-1" automationId="automation-1" />,
    { wrapper: Wrapper },
  );

describe("OwnSlackTokenNudge", () => {
  afterEach(() => {
    cleanup();
    projectIntegration.current = { connected: false };
    switchCalls.length = 0;
  });

  describe("given the project has a Slack integration", () => {
    /** @scenario "An automation using its own token is flagged where it appears" */
    it("says the automation uses its own token and offers the switch", () => {
      projectIntegration.current = { connected: true };
      renderNudge();

      expect(screen.getByText(/uses its own slack token/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /use the project integration/i }),
      ).toBeInTheDocument();
    });

    /** @scenario "Switching a legacy automation to the project integration" */
    it("clears that automation's stored token when the switch is taken", () => {
      projectIntegration.current = { connected: true };
      renderNudge();

      fireEvent.click(
        screen.getByRole("button", { name: /use the project integration/i }),
      );

      expect(switchCalls).toEqual([
        { projectId: "project-1", automationIds: ["automation-1"] },
      ]);
    });
  });

  describe("given the project has no Slack integration to fall through to", () => {
    /** @scenario "An automation using its own token is flagged where it appears" */
    it("still flags the automation but offers no switch that would break it", () => {
      renderNudge();

      expect(screen.getByText(/uses its own slack token/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /use the project integration/i }),
      ).not.toBeInTheDocument();
    });
  });
});

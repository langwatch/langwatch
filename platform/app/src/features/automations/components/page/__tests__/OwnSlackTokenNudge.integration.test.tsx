/**
 * @vitest-environment jsdom
 *
 * ADR-093 §5 accepts that rotating the project token does not reach an
 * automation carrying its own — and pays for that with visibility rather than
 * silence. This is the list row's half of that bargain: the row says so, and
 * offers the one action that moves it.
 *
 * That action deletes the only copy of a credential nobody can read back and
 * the composer no longer has a field to retype, and it may repoint the
 * automation at a different Slack workspace. So the tests below are as much
 * about what does NOT happen on a click as about what does.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const switchCalls: { projectId: string; automationIds?: string[] }[] = [];

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      automation: { getTriggers: { invalidate: () => undefined } },
      slackIntegration: {
        getLegacyTokenCensus: { invalidate: () => undefined },
      },
    }),
    slackIntegration: {
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

const renderNudge = ({
  workspaceName = "Acme HQ",
  canSwitch = true,
}: {
  workspaceName?: string | null;
  canSwitch?: boolean;
} = {}) =>
  render(
    <OwnSlackTokenNudge
      projectId="project-1"
      automationId="automation-1"
      automationName="Error spike"
      workspaceName={workspaceName}
      canSwitch={canSwitch}
    />,
    { wrapper: Wrapper },
  );

const switchButton = () =>
  screen.getByRole("button", { name: /use the project integration/i });

describe("OwnSlackTokenNudge", () => {
  afterEach(() => {
    cleanup();
    switchCalls.length = 0;
  });

  describe("given a caller who can switch it", () => {
    /** @scenario "An automation using its own token is flagged where it appears" */
    it("says the automation uses its own token and offers the switch", () => {
      renderNudge();

      expect(screen.getByText(/uses its own slack token/i)).toBeInTheDocument();
      expect(switchButton()).toBeInTheDocument();
    });

    it("asks before doing anything, naming the workspace and the loss", async () => {
      renderNudge();

      fireEvent.click(switchButton());

      expect(
        await screen.findByText(
          /use the project integration for "error spike"/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/deleted and cannot be recovered/i),
      ).toHaveTextContent(/acme hq/i);
      // Nothing has happened yet — the click opened a question, not a write.
      expect(switchCalls).toEqual([]);
    });

    /** @scenario "Switching a legacy automation to the project integration" */
    it("clears that automation's stored token once the switch is confirmed", async () => {
      renderNudge();

      fireEvent.click(switchButton());
      fireEvent.click(
        await screen.findByRole("button", { name: /switch this automation/i }),
      );

      expect(switchCalls).toEqual([
        { projectId: "project-1", automationIds: ["automation-1"] },
      ]);
    });

    it("leaves the token alone when the question is dismissed", async () => {
      renderNudge();

      fireEvent.click(switchButton());
      fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

      expect(switchCalls).toEqual([]);
    });
  });

  describe("given a caller without permission to change the project", () => {
    /** @scenario "An automation using its own token is flagged where it appears" */
    it("still flags the automation but offers no switch the server would refuse", () => {
      renderNudge({ canSwitch: false });

      expect(screen.getByText(/uses its own slack token/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /use the project integration/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a project with no Slack integration to fall through to", () => {
    it("offers no switch that would leave the automation unable to deliver", () => {
      // canSwitch true on purpose: the missing workspace alone must hide the
      // action, not only the caller's composed permission flag.
      renderNudge({ workspaceName: null, canSwitch: true });

      expect(screen.getByText(/uses its own slack token/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /use the project integration/i }),
      ).not.toBeInTheDocument();
    });
  });
});

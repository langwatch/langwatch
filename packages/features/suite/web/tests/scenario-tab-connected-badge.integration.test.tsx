/**
 * @vitest-environment jsdom
 *
 * Covers specs/scenarios/scenario-tab-handoff.feature — the connected badge.
 *
 * The badge is the only trace the tab-reuse feature leaves in the UI: runs are
 * followed silently, so this marker is how a user tells the SDK-opened tab
 * apart from one they opened themselves.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ScenarioTabConnectedBadge } from "../src/scenario-tab-connected-badge";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ScenarioTabConnectedBadge/>", () => {
  afterEach(() => {
    cleanup();
  });

  /** @scenario "A connected tab quietly shows that it is linked to local runs" */
  it("says the tab is connected to a local run", () => {
    render(<ScenarioTabConnectedBadge visible={true} />, { wrapper: Wrapper });

    expect(screen.getByText("Connected to local run")).toBeInTheDocument();
  });

  /** @scenario "A connected tab quietly shows that it is linked to local runs" */
  it("explains on hover that new runs will land in this tab", async () => {
    const user = userEvent.setup();
    render(<ScenarioTabConnectedBadge visible={true} />, { wrapper: Wrapper });

    await user.hover(screen.getByTestId("scenario-tab-connected-badge"));

    await waitFor(() =>
      expect(screen.getByTestId("scenario-tab-connected-popover")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/this view moves to it instead of opening another/i),
    ).toBeInTheDocument();
  });

  /** @scenario "A connected tab quietly shows that it is linked to local runs" */
  it("renders nothing for a tab the user opened themselves", () => {
    const { container } = render(<ScenarioTabConnectedBadge visible={false} />, {
      wrapper: Wrapper,
    });

    expect(container).toBeEmptyDOMElement();
  });
});

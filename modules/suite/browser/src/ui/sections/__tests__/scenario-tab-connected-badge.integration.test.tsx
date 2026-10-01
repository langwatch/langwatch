/**
 * Connected badge for SDK-opened tabs.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ScenarioTabConnectedBadge } from "../../elements/runs/scenario-tab-connected-badge.tsx";

describe("<ScenarioTabConnectedBadge/>", () => {
  afterEach(() => {
    cleanup();
  });

  /** @scenario "A connected tab quietly shows that it is linked to local runs" */
  it("says the tab is connected to a local run", () => {
    renderWithDesignSystem(<ScenarioTabConnectedBadge visible={true} />);

    expect(screen.getByText("Connected to local run")).toBeInTheDocument();
  });

  /** @scenario "A connected tab quietly shows that it is linked to local runs" */
  it("explains on hover that new runs will land in this tab", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<ScenarioTabConnectedBadge visible={true} />);

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
    const { container } = renderWithDesignSystem(<ScenarioTabConnectedBadge visible={false} />);

    expect(container).toBeEmptyDOMElement();
  });
});

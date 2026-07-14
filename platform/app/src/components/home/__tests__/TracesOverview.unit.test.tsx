/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { slug: "my-project" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/components/PeriodSelector", () => ({
  usePeriodSelector: () => ({ daysDifference: 1 }),
}));

vi.mock("~/components/analytics/CustomGraph", () => ({
  CustomGraph: ({ emptyState }: { emptyState?: React.ReactNode }) => (
    <div data-testid="traces-overview-graph">{emptyState}</div>
  ),
}));

vi.mock("~/components/ui/link", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { TracesOverview } from "../TracesOverview";

function renderWithProviders(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("<TracesOverview /> feature gate", () => {
  afterEach(cleanup);

  it("hides the Langy investigation action when Langy is unavailable", () => {
    renderWithProviders(<TracesOverview />);

    expect(screen.queryByText("Investigate signal")).toBeNull();
    expect(screen.getByTestId("traces-overview-graph")).toBeDefined();
  });

  it("shows the Langy investigation action when explicitly enabled", () => {
    renderWithProviders(<TracesOverview showInvestigateSignal />);

    expect(
      screen.getByRole("link", { name: /Investigate signal/ }),
    ).toBeDefined();
  });

  it("offers useful first actions instead of a dead no-data message", () => {
    renderWithProviders(<TracesOverview />);

    expect(
      screen.getByText("Nothing here yet — pick a quick start"),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: /Connect tracing/ }),
    ).toHaveAttribute("href", "/my-project/traces");
    expect(
      screen.getByRole("link", { name: /Create a prompt/ }),
    ).toHaveAttribute("href", "/my-project/prompts");
    expect(
      screen.getByRole("link", { name: /Run a simulation/ }),
    ).toHaveAttribute("href", "/my-project/simulations");
  });
});

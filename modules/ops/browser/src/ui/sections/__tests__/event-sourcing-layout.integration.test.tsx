/** @vitest-environment jsdom */

import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const countsQuery = vi.hoisted(() => vi.fn());

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: { ops: { listDeadLetterCounts: { useQuery: countsQuery } } },
}));
vi.mock("../../../behavior/ops-router.ts", () => ({
  useOpsRouter: () => ({ asPath: "/ops/event-sourcing", push: vi.fn() }),
}));

import { EventSourcingLayout } from "../event-sourcing-layout.tsx";

afterEach(cleanup);

describe("the event sourcing rail", () => {
  /** @scenario A text rail preserves operational counts */
  it("keeps the dead-letter total beside the text and separates section and page titles", () => {
    countsQuery.mockReturnValue({ data: [{ count: 3 }, { count: 4 }] });

    render(
      <DesignSystemProvider forcedTheme="light">
        <EventSourcingLayout pageTitle="Event sourcing">Content</EventSourcingLayout>
      </DesignSystemProvider>,
    );

    const nav = screen.getByRole("navigation", { name: "Event sourcing navigation" });
    const deadLetters = within(nav).getByRole("link", { name: "Dead letters 7" });
    expect(within(deadLetters).getByText("7")).toBeInTheDocument();
    expect(within(nav).getByText("Event sourcing")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

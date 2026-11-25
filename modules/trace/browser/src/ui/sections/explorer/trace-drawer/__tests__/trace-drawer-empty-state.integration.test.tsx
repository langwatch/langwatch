/**
 * @vitest-environment jsdom
 * The trace drawer's error state, for a withheld trace and for an ordinary load failure.
 * @see specs/billing/over-plan-trace-withholding.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TraceDrawerEmptyState } from "../trace-drawer-empty-state.tsx";

const handledError = (code: string) => ({ data: { code: "FORBIDDEN", error: { code } } });

const renderEmptyState = ({ error, onRetry }: { error: unknown; onRetry: () => void }) =>
  render(
    <TraceDrawerEmptyState error={error} traceId="trace-1" onClose={vi.fn()} onRetry={onRetry} />,
    {
      wrapper: ({ children }) => (
        <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
      ),
    },
  );

afterEach(() => cleanup());

describe("<TraceDrawerEmptyState/>", () => {
  describe("when the trace is withheld because the organization is over its plan", () => {
    /** @scenario "Opening a withheld trace in the drawer offers the plan's way out, not a retry" */
    it("offers Compare plans and Manage members instead of Try again", () => {
      renderEmptyState({ error: handledError("trace_withheld_over_plan"), onRetry: vi.fn() });

      expect(screen.getByText("Trace held until your plan is sorted")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Compare plans" }).getAttribute("href")).toBe(
        "/settings/subscription",
      );
      expect(screen.getByRole("link", { name: "Manage members" }).getAttribute("href")).toBe(
        "/settings/members",
      );
      expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
    });
  });

  describe("when the trace failed to load for another reason", () => {
    /** @scenario "A trace that failed to load for another reason still offers a retry" */
    it("offers Try again and no plan actions", () => {
      const onRetry = vi.fn();
      renderEmptyState({ error: new Error("network down"), onRetry });

      fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("link", { name: "Compare plans" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Manage members" })).toBeNull();
    });
  });
});

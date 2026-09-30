/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearDrawerStack, clearFlowCallbacks } from "../../../behavior/use-drawer.ts";
import { CurrentDrawer } from "../current-drawer.tsx";

function AutomationDrawer({ initialFilterQuery }: { initialFilterQuery?: string }) {
  return <div data-testid="automation-drawer">{initialFilterQuery}</div>;
}

const drawers = { automation: AutomationDrawer };

function mount(at: string): void {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/:project/traces" element={<CurrentDrawer drawers={drawers} />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearDrawerStack();
  clearFlowCallbacks();
});

afterEach(() => {
  cleanup();
});

describe("<CurrentDrawer/>", () => {
  describe("given a trace-explorer link whose drawer query is followed by a #fragment", () => {
    /** @scenario "A trace-explorer link opens the automation drawer with only the filter it carries" */
    it("hands the drawer its props without the fragment", async () => {
      mount(
        "/acme/traces?drawer.open=automation&drawer.initialFilterQuery=status%3Aerror#simplified",
      );

      expect(await screen.findByTestId("automation-drawer")).toHaveTextContent(/^status:error$/);
    });
  });

  describe("given drawer params parked after a lens fragment", () => {
    it("still opens the drawer they name", async () => {
      mount(
        "/acme/traces#conversations?drawer.open=automation&drawer.initialFilterQuery=status%3Aok",
      );

      expect(await screen.findByTestId("automation-drawer")).toHaveTextContent(/^status:ok$/);
    });
  });
});

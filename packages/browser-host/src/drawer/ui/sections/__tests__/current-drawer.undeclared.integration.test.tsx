/**
 * @vitest-environment jsdom
 * A drawer name no installed module declared: an address carrying one still renders the page
 * and is stripped, and opening one is refused by name (ADR-148 §8).
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { navigateToDrawer, useDrawer } from "../../../behavior/use-drawer.ts";
import { BrowserDrawerUndeclaredError } from "../../../model/drawer-declarations.ts";
import { CurrentDrawer } from "../current-drawer.tsx";

function DeclaredDrawer() {
  return <p>the declared drawer</p>;
}

const drawers = { declared: DeclaredDrawer };

let refusal: unknown;

function Page() {
  const location = useLocation();
  const { openDrawer } = useDrawer();
  const open = (name: string) => {
    try {
      openDrawer(name as "declared");
    } catch (error) {
      refusal = error;
    }
  };
  return (
    <>
      <p>the page</p>
      <output data-testid="address">{location.search}</output>
      <button type="button" onClick={() => open("retired")}>
        open retired
      </button>
      <button type="button" onClick={() => open("declared")}>
        open declared
      </button>
    </>
  );
}

function renderAt(address: string) {
  return render(
    <MemoryRouter initialEntries={[address]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Page />
              <CurrentDrawer drawers={drawers} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  refusal = void 0;
  vi.restoreAllMocks();
});

describe("CurrentDrawer, given a drawer name no installed module declared", () => {
  it("renders the page from a stale address, strips the drawer and reports the refusal by name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => void 0);

    renderAt("/project?tab=all&drawer.open=retired&drawer.traceId=t1");

    expect(screen.getByText("the page")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("address").textContent).toBe("?tab=all"));
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "browser_drawer_undeclared", drawer: "retired" }),
    );
    expect(screen.queryByText("the declared drawer")).toBeNull();
  });

  it("refuses opening the name, naming it, and leaves the address as it was", async () => {
    renderAt("/project?tab=all");

    await userEvent.click(screen.getByRole("button", { name: "open retired" }));

    expect(refusal).toBeInstanceOf(BrowserDrawerUndeclaredError);
    expect(refusal).toMatchObject({ code: "browser_drawer_undeclared", drawer: "retired" });
    expect(screen.getByTestId("address").textContent).toBe("?tab=all");
  });

  it("refuses the name from module-level code too", () => {
    renderAt("/project");

    expect(() => navigateToDrawer("retired")).toThrow(BrowserDrawerUndeclaredError);
  });

  it("still opens a declared drawer", async () => {
    renderAt("/project");

    await userEvent.click(screen.getByRole("button", { name: "open declared" }));

    expect(await screen.findByText("the declared drawer")).toBeTruthy();
    expect(refusal).toBeUndefined();
  });
});

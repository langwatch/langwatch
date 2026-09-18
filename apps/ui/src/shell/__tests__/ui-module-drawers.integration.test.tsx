/**
 * @vitest-environment jsdom
 * The drawer law, end to end: a module declares a drawer, the shell composes
 * one registry, and the address bar is what opens and stacks it.
 */
import { clearDrawerStack, CurrentDrawer, useDrawer } from "@langwatch/browser-host/drawer";
import { defineWebModule } from "@langwatch/ui-kernel";
import { UiDesignSystemShell } from "@langwatch/ui-kernel/design-system-shell";
import { installedModuleDrawers } from "@langwatch/ui-kernel/module-drawers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { uiDesignSystem } from "../../design-system";

// jsdom ships no matchMedia, and the colour-mode provider reads it on mount.
beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  clearDrawerStack();
  window.history.replaceState(null, "", "/");
});

/** A sub-flow NAVIGATES to the next drawer; it never mounts one itself. */
function TraceDetailsDrawer({ traceId }: { traceId?: string }) {
  const { openDrawer } = useDrawer();
  return (
    <div>
      <p>trace drawer {traceId}</p>
      <button type="button" onClick={() => openDrawer("evaluatorEditor")}>
        edit the evaluator
      </button>
    </div>
  );
}

function EvaluatorEditorDrawer() {
  const { goBack } = useDrawer();
  return (
    <div>
      <p>evaluator drawer</p>
      <button type="button" onClick={() => goBack()}>
        back
      </button>
    </div>
  );
}

const traceModule = defineWebModule("trace").withDrawers({
  traceDetails: { load: () => Promise.resolve({ default: TraceDetailsDrawer }) },
});

const evaluatorModule = defineWebModule("evaluator").withDrawers({
  evaluatorEditor: { load: () => Promise.resolve({ default: EvaluatorEditorDrawer }) },
});

/**
 * The address bar itself, not a memory router: the drawer stack reads
 * `window.location` to seed itself from a deep link, so a router that keeps
 * its own history would prove the wrong thing.
 */
function renderAt(address: string) {
  window.history.replaceState(null, "", address);
  const drawers = installedModuleDrawers([traceModule, evaluatorModule]);

  return render(
    <UiDesignSystemShell system={uiDesignSystem}>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<CurrentDrawer drawers={drawers} />} />
        </Routes>
      </BrowserRouter>
    </UiDesignSystemShell>,
  );
}

describe("installed module drawers", () => {
  it("opens the drawer the address names, with the props the address carries", async () => {
    renderAt("/my-project/traces?drawer.open=traceDetails&drawer.traceId=trace-1");

    expect(await screen.findByText("trace drawer trace-1")).toBeTruthy();
  });

  it("mounts nothing when the address names no drawer", () => {
    renderAt("/my-project/traces");

    expect(screen.queryByText(/drawer/)).toBeNull();
  });

  it("mounts nothing when the address names a drawer no module declared", () => {
    renderAt("/my-project/traces?drawer.open=neverDeclared");

    expect(screen.queryByText(/drawer/)).toBeNull();
  });

  it("swaps one drawer for the next and comes back, rather than mounting two", async () => {
    renderAt("/my-project/traces?drawer.open=traceDetails&drawer.traceId=trace-1");
    fireEvent.click(await screen.findByRole("button", { name: "edit the evaluator" }));

    expect(await screen.findByText("evaluator drawer")).toBeTruthy();
    expect(screen.queryByText("trace drawer trace-1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "back" }));

    expect(await screen.findByText("trace drawer trace-1")).toBeTruthy();
    expect(screen.queryByText("evaluator drawer")).toBeNull();
  });
});

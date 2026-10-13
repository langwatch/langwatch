import { defineBrowserModule } from "@langwatch/browser";
/**
 * @vitest-environment jsdom
 * The drawer law, end to end: a module declares a drawer, the shell composes
 * one registry, and the address bar is what opens and stacks it.
 */
import { UiScope, UiSession } from "@langwatch/browser-host/capabilities";
import { CurrentDrawer, useDrawer } from "@langwatch/browser-host/drawer";
import { createUiFeatureShell } from "@langwatch/browser/feature-shell";
import { installedModuleDrawers } from "@langwatch/browser/module-drawers";
import { UiDesignSystemShell } from "@langwatch/browser/outer-providers";
import { useProductAccent } from "@langwatch/design-system/use-product-accent";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { BrowserRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { composeUiDesignSystem, loadUiRootHostServices } from "../ui-root-host-services";

const rootHostServices = await loadUiRootHostServices();
const uiDesignSystem = composeUiDesignSystem(rootHostServices);

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

const traceModule = defineBrowserModule("trace").withDrawers({
  traceDetails: { load: () => Promise.resolve({ default: TraceDetailsDrawer }) },
});

const evaluatorModule = defineBrowserModule("evaluator").withDrawers({
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

class StubSession extends UiSession {
  currentUser() {
    return { id: "user_1", name: "Ada", email: "ada@example.com", image: null };
  }

  hasPermission(): boolean {
    return true;
  }

  isSettled(): boolean {
    return true;
  }
}

class StubScope extends UiScope {
  activeScope() {
    return { organizationId: "org_1", projectId: "project_1" };
  }
}

function AccentReading({ id }: { id: string }) {
  const accent = useProductAccent();
  return (
    <p data-testid={id}>
      {accent.product ?? "none"}|{accent.colorPalette}
    </p>
  );
}

/** A menu opened from the drawer: its DOM sits on the body, outside the page and the drawer. */
function AccentDrawer() {
  return (
    <div>
      <AccentReading id="drawer" />
      {createPortal(<AccentReading id="menu" />, document.body)}
    </div>
  );
}

const accentModule = defineBrowserModule("accent").withDrawers({
  accentProbe: { load: () => Promise.resolve({ default: AccentDrawer }) },
});

function renderInstalledShell(address: string) {
  window.history.replaceState(null, "", address);
  const Shell = createUiFeatureShell({
    sessionQueryKey: ["test", "session"],
    apis: [],
    capabilities: { session: new StubSession(), scope: new StubScope() },
    drawers: installedModuleDrawers([accentModule]),
    presentation: rootHostServices.navigationChrome.ProductAccentScope,
  });

  return render(
    <UiDesignSystemShell system={uiDesignSystem}>
      <BrowserRouter>
        <Routes>
          <Route
            path="*"
            element={
              <Shell>
                <AccentReading id="page" />
              </Shell>
            }
          />
        </Routes>
      </BrowserRouter>
    </UiDesignSystemShell>,
  );
}

describe("the installed shell with navigation's presentation provider", () => {
  /** @scenario "The installed shell gives the page and the open drawer the product of the address" */
  it("gives the page, the open drawer and its portalled menu the Me accent on a Me address", async () => {
    renderInstalledShell("/me/configure?drawer.open=accentProbe");

    expect((await screen.findByTestId("drawer")).textContent).toBe("me|product.me");
    expect(screen.getByTestId("page").textContent).toBe("me|product.me");
    expect(screen.getByTestId("menu").textContent).toBe("me|product.me");
  });

  /** @scenario "The installed shell gives the page and the open drawer the product of the address" */
  it("gives all three the unscoped accent on a settings address", async () => {
    renderInstalledShell("/settings/members?drawer.open=accentProbe");

    expect((await screen.findByTestId("drawer")).textContent).toBe("none|accent");
    expect(screen.getByTestId("page").textContent).toBe("none|accent");
    expect(screen.getByTestId("menu").textContent).toBe("none|accent");
  });
});

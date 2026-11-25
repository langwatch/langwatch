/**
 * @vitest-environment jsdom
 * Focus across the routed drawer stack: a drawer mounts open and leaves the tree without an exit,
 * so the page opener must travel with the stack and come back only when the stack is gone.
 * @see packages/design-system/specs/overlay-shapes.feature
 */

import { Drawer } from "@langwatch/design-system/drawer";
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { uiTokens } from "@langwatch/module";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lazy } from "react";
import { type Location, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearFlowCallbacks, useDrawer } from "../../../behavior/use-drawer.ts";
import { CurrentDrawer } from "../current-drawer.tsx";

const SecondToken = uiTokens("trace").drawer<object>("second");

function FirstDrawer() {
  const { openDrawer, closeDrawer } = useDrawer();
  return (
    <Drawer open onClose={closeDrawer} title="First drawer">
      <button type="button" onClick={() => openDrawer(SecondToken)}>
        Go to second
      </button>
      <input aria-label="First field" />
    </Drawer>
  );
}

function SecondDrawer() {
  const { closeDrawer, goBack } = useDrawer();
  return (
    <Drawer open onClose={closeDrawer} onBack={goBack} title="Second drawer">
      <input aria-label="Second field" />
    </Drawer>
  );
}

let releaseSecond: () => void = () => undefined;
const LazySecond = lazy(
  () =>
    new Promise<{ default: typeof SecondDrawer }>((resolve) => {
      releaseSecond = () => resolve({ default: SecondDrawer });
    }),
);

let lastLocation: Location | undefined;

function PageChrome() {
  const { openDrawer } = useDrawer();
  const navigate = useNavigate();
  lastLocation = useLocation();
  return (
    <>
      <button type="button" onClick={() => openDrawer(uiTokens("trace").drawer<object>("first"))}>
        Open first
      </button>
      <button type="button" onClick={() => void navigate(-1)}>
        Browser back
      </button>
    </>
  );
}

function mount({ at, second }: { at: string; second: "eager" | "lazy" }) {
  const drawers = { first: FirstDrawer, second: second === "lazy" ? LazySecond : SecondDrawer };
  render(
    <DesignSystemTestProvider>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route
            path="/:project/traces"
            element={
              <>
                <PageChrome />
                <CurrentDrawer drawers={drawers} />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </DesignSystemTestProvider>,
  );
}

function stubLayout() {
  const rect = new DOMRect(0, 0, 10, 10);
  const rects: DOMRectList = {
    0: rect,
    length: 1,
    item: (index: number) => (index === 0 ? rect : null),
    [Symbol.iterator]: () => [rect][Symbol.iterator](),
  };
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue(rects);
}

const drawerNamed = (name: string) => screen.findByRole("dialog", { name });
const focusIsIn = (drawer: HTMLElement) =>
  waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));

beforeEach(() => {
  stubLayout();
  clearFlowCallbacks();
  lastLocation = undefined;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the routed drawer stack and focus", () => {
  describe.each(["eager", "lazy"] as const)("given a %s second drawer", (second) => {
    /** @scenario "A routed drawer stack hands the page opener to its last drawer" */
    it("restores nothing on a push or a back, and returns to the page button when the stack closes", async () => {
      const user = userEvent.setup();
      mount({ at: "/acme/traces", second });
      const opener = screen.getByRole("button", { name: "Open first" });

      await user.click(opener);
      const first = await drawerNamed("First drawer");
      await focusIsIn(first);
      const focus = vi.spyOn(opener, "focus");
      await user.click(within(first).getByRole("button", { name: "Go to second" }));
      await act(async () => undefined);
      expect(focus).not.toHaveBeenCalled();
      if (second === "lazy") await act(async () => releaseSecond());
      const next = await drawerNamed("Second drawer");
      await focusIsIn(next);
      expect(focus).not.toHaveBeenCalled();

      await user.click(within(next).getByRole("button", { name: "Back" }));
      const returned = await drawerNamed("First drawer");
      await focusIsIn(returned);
      expect(focus).not.toHaveBeenCalled();

      await user.click(within(returned).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(opener));
      expect(focus).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the reader goes back with the browser", () => {
    /** @scenario "A routed drawer stack hands the page opener to its last drawer" */
    it("focuses the returned drawer rather than the page behind it", async () => {
      const user = userEvent.setup();
      mount({ at: "/acme/traces", second: "eager" });
      const opener = screen.getByRole("button", { name: "Open first" });
      await user.click(opener);
      await user.click(
        within(await drawerNamed("First drawer")).getByRole("button", { name: "Go to second" }),
      );
      await drawerNamed("Second drawer");
      const focus = vi.spyOn(opener, "focus");

      await user.click(screen.getByRole("button", { name: "Browser back" }));

      await focusIsIn(await drawerNamed("First drawer"));
      expect(lastLocation?.search).toBe("?drawer.open=first");
      expect(focus).not.toHaveBeenCalled();
    });
  });

  describe("given a deep link that opened the drawer", () => {
    /** @scenario "A routed drawer stack hands the page opener to its last drawer" */
    it("has no opener to restore, so closing leaves focus alone and throws nothing", async () => {
      const user = userEvent.setup();
      mount({ at: "/acme/traces?drawer.open=first", second: "eager" });
      const first = await drawerNamed("First drawer");
      await focusIsIn(first);

      await user.click(within(first).getByRole("button", { name: "Close" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(document.activeElement).toBe(document.body);
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * Whether the authoring drawer is still in the open flow, read off the real
 * navigation stack driven by the real `useDrawer`. The stack is what separates
 * a sub-flow from a close, so a change to how it is kept has to fail here
 * rather than silently start wiping drafts on the way back from a sub-flow.
 * See specs/automations/authoring-drawer.feature.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const PATH = "/my-project/automations";
  const liveQuery = (): Record<string, string> => {
    const query: Record<string, string> = {};
    new URLSearchParams(window.location.search).forEach((value, key) => {
      query[key] = value;
    });
    return query;
  };
  const navigate = (url: string) => {
    window.history.replaceState({}, "", url);
    return Promise.resolve(true);
  };
  return {
    PATH,
    router: {
      get query() {
        return liveQuery();
      },
      pathname: "/[project]/automations",
      get asPath() {
        return window.location.pathname + window.location.search;
      },
      push: navigate,
      replace: navigate,
    },
  };
});

vi.mock("~/utils/compat/next-router", () => ({
  default: harness.router,
  useRouter: () => harness.router,
}));

const { clearDrawerStack, useDrawer } = await import("~/hooks/useDrawer");
const { isInAutomationFlow } = await import("../subFlow");

beforeEach(() => {
  window.history.replaceState({}, "", harness.PATH);
  clearDrawerStack();
});

afterEach(cleanup);

describe("automation drawer flow membership", () => {
  describe("given no drawer is open", () => {
    it("reports no flow, so an unmount resets the draft", () => {
      expect(isInAutomationFlow()).toBe(false);
    });
  });

  describe("given the authoring drawer opened a dataset sub-flow", () => {
    describe("when the authoring drawer unmounts for the push", () => {
      /** @scenario "Creating a dataset from the automation is offered and works" */
      it("reports the flow is still open, so the draft is kept", () => {
        const { result } = renderHook(() => useDrawer());
        act(() => result.current.openDrawer("automation"));
        expect(isInAutomationFlow()).toBe(true);

        act(() => result.current.openDrawer("addOrEditDataset"));

        expect(isInAutomationFlow()).toBe(true);
      });
    });

    describe("when the sub-flow returns", () => {
      /** @scenario "Creating a dataset from the automation is offered and works" */
      it("still reports the flow, so a replayed unmount keeps the draft", () => {
        const { result } = renderHook(() => useDrawer());
        act(() => result.current.openDrawer("automation"));
        act(() => result.current.openDrawer("addOrEditDataset"));

        act(() => result.current.goBack());

        // React StrictMode replays the unmount of the drawer that just came
        // back. Reading the stack answers the same way every time, so the
        // replay cannot wipe the returned draft.
        expect(isInAutomationFlow()).toBe(true);
        expect(isInAutomationFlow()).toBe(true);
      });
    });
  });

  describe("given the authoring drawer is closed outright", () => {
    describe("when it unmounts", () => {
      it("reports no flow, so the draft is reset", () => {
        const { result } = renderHook(() => useDrawer());
        act(() => result.current.openDrawer("automation"));

        act(() => result.current.closeDrawer());

        expect(isInAutomationFlow()).toBe(false);
      });
    });
  });

  describe("given the drawer was opened through its legacy alias", () => {
    it("counts as the same flow", () => {
      const { result } = renderHook(() => useDrawer());
      act(() => result.current.openDrawer("editAutomationFilter"));

      act(() => result.current.openDrawer("addOrEditDataset"));

      expect(isInAutomationFlow()).toBe(true);
    });
  });
});

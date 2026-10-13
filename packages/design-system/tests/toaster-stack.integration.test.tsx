// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster, toaster } from "../src/components/overlays/toaster.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

beforeEach(() => {
  toaster.remove();
  renderWithDesignSystem(<Toaster />);
});
afterEach(() => {
  cleanup();
  toaster.remove();
  vi.restoreAllMocks();
});

function roots(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-scope="toast"][data-part="root"]')];
}

function group(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[data-scope="toast"][data-part="group"]');
  if (!region) throw new Error("no toast region");
  return region;
}

async function raise(count: number) {
  act(() => {
    for (let index = 1; index <= count; index++) {
      toaster.create({ title: `Notice ${index}`, type: index === 1 ? "error" : "info" });
    }
  });
  await screen.findByText(`Notice ${count}`);
}

async function expectExpanded(expanded: boolean) {
  await waitFor(() => {
    for (const root of roots()) expect(root.hasAttribute("data-stack")).toBe(expanded);
  });
}

function pointer(root: HTMLElement, type: string, x: number, y = 0, time = 100) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, timeStamp: { value: time } });
  fireEvent(root, event);
}

function swipeRoot(index = 0): HTMLElement {
  const root = roots()[index];
  if (!root) throw new Error("no front toast");
  Object.defineProperty(root, "setPointerCapture", { value: () => void 0 });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 60));
  return root;
}

describe("the shared toaster's stack", () => {
  /** @scenario "A burst of toasts collapses into one stack" */
  it("overlaps with the newest in front and preserves live announcements", async () => {
    await raise(3);
    expect(roots()).toHaveLength(3);
    await expectExpanded(false);
    expect(roots()[0]?.textContent).toContain("Notice 3");
    expect(group().getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("alert").textContent).toContain("Notice 1");
  });

  /** @scenario "Hover lifts the peeking cards and holds every timer" */
  it("holds timers on hover without expanding and resumes on leave", async () => {
    await raise(3);
    fireEvent.pointerEnter(group());
    fireEvent.mouseEnter(group());
    fireEvent.mouseMove(group());
    await waitFor(() => {
      for (const root of roots()) expect(root.hasAttribute("data-paused")).toBe(true);
    });
    await expectExpanded(false);
    fireEvent.pointerLeave(group());
    fireEvent.mouseLeave(group());
    await waitFor(() => {
      for (const root of roots()) expect(root.hasAttribute("data-paused")).toBe(false);
    });
  });

  /** @scenario "Click opens the list until dismissed" */
  it("expands on click, stays open on leave, and collapses outside or on Escape", async () => {
    await raise(3);
    fireEvent.click(screen.getByText("Notice 3"));
    await expectExpanded(true);
    fireEvent.pointerLeave(group());
    await expectExpanded(true);
    for (const root of roots()) expect(root.hasAttribute("data-paused")).toBe(true);
    fireEvent.pointerDown(document.body);
    await expectExpanded(false);
    fireEvent.click(screen.getByText("Notice 3"));
    await expectExpanded(true);
    fireEvent.keyDown(roots()[0]!, { key: "Escape" });
    await expectExpanded(false);
    expect(roots()).toHaveLength(3);
    for (const root of roots()) expect(root.getAttribute("data-state")).toBe("open");
  });

  it("expands for keyboard focus and collapses when only one card remains", async () => {
    await raise(3);
    act(() => roots()[0]?.focus());
    await expectExpanded(true);
    act(() => {
      const visible = toaster.getVisibleToasts();
      for (const toast of visible.slice(1)) toaster.remove(toast.id);
    });
    await waitFor(() => expect(roots()).toHaveLength(1));
    await expectExpanded(false);
  });

  it("holds a newly arriving toast while expanded", async () => {
    await raise(2);
    fireEvent.click(screen.getByText("Notice 2"));
    await expectExpanded(true);
    act(() => {
      toaster.create({ title: "New arrival" });
    });
    await screen.findByText("New arrival");
    await expectExpanded(true);
    await waitFor(() => {
      for (const root of roots()) expect(root.hasAttribute("data-paused")).toBe(true);
    });
  });

  it("keeps close and action buttons independent of expansion", async () => {
    await raise(2);
    const action = vi.fn();
    act(() => {
      toaster.create({ title: "Action", action: { label: "Undo", onClick: action } });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(action).toHaveBeenCalledOnce();
    await expectExpanded(false);
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss notification" })[1]!);
    await expectExpanded(false);
  });

  /** @scenario "A horizontal swipe dismisses a card without opening the stack" */
  it.each([180, -180])("dismisses a card dragged %i pixels", async (distance) => {
    await raise(3);
    const root = swipeRoot();
    pointer(root, "pointerdown", 0);
    pointer(root, "pointermove", distance, 0, 500);
    expect(root.style.transform).toBe(`translateX(${distance}px)`);
    pointer(root, "pointerup", distance, 0, 700);
    fireEvent.click(root);
    await waitFor(() => expect(root.getAttribute("data-state")).toBe("closed"));
    await expectExpanded(false);
  });

  /** @scenario "A short drag springs back and never counts as a click" */
  it("springs a short slow drag back without expanding", async () => {
    await raise(3);
    const root = swipeRoot();
    pointer(root, "pointerdown", 0);
    pointer(root, "pointermove", 50, 0, 500);
    pointer(root, "pointerup", 50, 0, 700);
    fireEvent.click(root);
    await waitFor(() => expect(root.style.transform).toBe(""));
    expect(root.getAttribute("data-state")).toBe("open");
    await expectExpanded(false);
  });

  it("dismisses a quick flick below the distance threshold", async () => {
    await raise(2);
    const root = swipeRoot();
    pointer(root, "pointerdown", 0);
    pointer(root, "pointermove", 60, 0, 130);
    pointer(root, "pointerup", 60, 0, 140);
    await waitFor(() => expect(root.getAttribute("data-state")).toBe("closed"));
  });

  it("lets a rear card be swiped when expanded", async () => {
    await raise(3);
    fireEvent.click(screen.getByText("Notice 3"));
    await expectExpanded(true);
    const root = swipeRoot(1);
    pointer(root, "pointerdown", 0);
    pointer(root, "pointermove", -180, 0, 500);
    pointer(root, "pointerup", -180, 0, 700);
    await waitFor(() => expect(root.getAttribute("data-state")).toBe("closed"));
    expect(roots()[0]?.textContent).toContain("Notice 3");
  });

  it("preserves a caller's explicit pause when another toast arrives", async () => {
    await raise(2);
    act(() => toaster.pause());
    await waitFor(() => expect(roots()[0]?.hasAttribute("data-paused")).toBe(true));
    act(() => {
      toaster.create({ title: "Another notice" });
    });
    await screen.findByText("Another notice");
    expect(roots()[1]?.hasAttribute("data-paused")).toBe(true);
  });

  /** @scenario "Reduced motion makes stack changes immediate" */
  it("returns and dismisses immediately with reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((media) => ({
      media,
      matches: media === "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: () => void 0,
      removeListener: () => void 0,
      addEventListener: () => void 0,
      removeEventListener: () => void 0,
      dispatchEvent: () => true,
    }));
    await raise(2);
    const root = swipeRoot();
    pointer(root, "pointerdown", 0);
    pointer(root, "pointermove", 20, 0, 500);
    pointer(root, "pointerup", 20, 0, 700);
    await waitFor(() => expect(root.style.transform).toBe(""));
    pointer(root, "pointerdown", 0);
    pointer(root, "pointermove", 180, 0, 500);
    pointer(root, "pointerup", 180, 0, 700);
    await act(async () => {
      await Promise.resolve();
    });
    expect(root.getAttribute("data-state")).toBe("closed");
  });

  it("ignores vertical movement and springs back cancelled horizontal gestures", async () => {
    await raise(2);
    const root = swipeRoot();
    pointer(root, "pointerdown", 0);
    pointer(root, "pointermove", 10, 100, 500);
    pointer(root, "pointermove", 180, 110, 600);
    pointer(root, "pointerup", 180, 110, 700);
    expect(root.style.transform).toBe("");
    pointer(root, "pointerdown", 0);
    pointer(root, "pointermove", 180, 0, 500);
    pointer(root, "pointercancel", 180, 0, 700);
    await waitFor(() => expect(root.style.transform).toBe(""));
    expect(root.getAttribute("data-state")).toBe("open");
  });
});

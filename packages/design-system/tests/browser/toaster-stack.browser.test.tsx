import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { Toaster, toaster } from "../../src/components/overlays/toaster.tsx";
import { renderWithDesignSystem } from "../../src/testing/index.tsx";

beforeEach(() => {
  toaster.remove();
  renderWithDesignSystem(<Toaster />);
});
afterEach(() => {
  cleanup();
  toaster.remove();
});

const front = () => {
  const root = document.querySelector<HTMLElement>(
    '[data-scope="toast"][data-part="root"][data-first]',
  );
  if (!root) throw new Error("no front toast");
  return root;
};
const roots = () => [
  ...document.querySelectorAll<HTMLElement>('[data-scope="toast"][data-part="root"]'),
];
const tops = () => roots().map((root) => root.getBoundingClientRect().top);

async function raise() {
  act(() => {
    for (const title of ["One", "Two", "Three"]) toaster.create({ title, duration: 60000 });
  });
  await screen.findByText("Three");
  await waitFor(() => expect(roots()).toHaveLength(3));
  await waitFor(() =>
    expect(roots().every((root) => root.hasAttribute("data-mounted"))).toBe(true),
  );
  await waitFor(() => expect(front().getBoundingClientRect().height).toBeGreaterThan(40));
  await waitFor(() => expect(getComputedStyle(front()).transform).toBe("none"));
}

describe("the toast stack interactions", () => {
  /** @scenario "Hover lifts the peeking cards and holds every timer" */
  it("lifts each rear card another 14px without moving the front or expanding", async () => {
    await raise();
    await waitFor(() => expect(getComputedStyle(front()).opacity).toBe("1"));
    const collapsed = tops();
    await userEvent.hover(front());
    await waitFor(() => {
      expect(collapsed[1]! - tops()[1]!).toBeCloseTo(14, 0);
      expect(collapsed[2]! - tops()[2]!).toBeCloseTo(28, 0);
    });
    expect(tops()[0]).toBeCloseTo(collapsed[0]!, 0);
    for (const root of roots()) {
      expect(root.hasAttribute("data-overlap")).toBe(true);
      expect(root.hasAttribute("data-paused")).toBe(true);
    }
    await userEvent.unhover(front());
    await waitFor(() => expect(tops()[1]).toBeCloseTo(collapsed[1]!, 0));
  });

  /** @scenario "Click opens the list until dismissed" */
  it("opens a list with 12px gaps and collapses on Escape and outside click", async () => {
    await raise();
    await userEvent.click(front());
    await waitFor(() => {
      const [first, second] = roots().map((root) => root.getBoundingClientRect());
      expect(first!.top - second!.bottom).toBeCloseTo(12, 0);
    });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(front().hasAttribute("data-overlap")).toBe(true));
    expect(roots()).toHaveLength(3);
    await userEvent.click(front());
    await waitFor(() => expect(front().hasAttribute("data-stack")).toBe(true));
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(front().hasAttribute("data-overlap")).toBe(true));
  });

  /** @scenario "A short drag springs back and never counts as a click" */
  it("follows a short drag then springs back, and dismisses past the width threshold", async () => {
    await raise();
    const root = front();
    const initial = root.getBoundingClientRect().left;
    fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 0 });
    // Synthetic pointers have no native capture; the cancelled path is covered in jsdom.
    Object.defineProperty(root, "setPointerCapture", { value: () => void 0 });
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 20 });
    expect(root.getBoundingClientRect().left - initial).toBeCloseTo(20, 0);
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 20 });
    fireEvent.click(root);
    await waitFor(() => expect(root.getBoundingClientRect().left).toBeCloseTo(initial, 0));
    expect(root.hasAttribute("data-overlap")).toBe(true);
    fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 0 });
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 200 });
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 200 });
    await waitFor(() => expect(root.getAttribute("data-state")).toBe("closed"));
  });
});

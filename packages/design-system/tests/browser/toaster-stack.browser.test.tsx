/**
 * The toast stack listing its cards on hover, measured in real Chromium.
 * @see specs/design-system/toast-stack.feature
 */
import { act, cleanup, screen, waitFor } from "@testing-library/react";
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
const spread = () => Math.max(...tops()) - Math.min(...tops());

describe("the toast stack on hover", () => {
  /** @scenario "Reaching for the stack lists every card and holds every timer" */
  it("lists the cards one above another while the pointer is over them", async () => {
    act(() => {
      for (const title of ["One", "Two", "Three"]) toaster.create({ title, duration: 60000 });
    });
    await screen.findByText("Three");
    await waitFor(() => expect(roots()).toHaveLength(3));
    await waitFor(() => expect(spread()).toBeLessThan(70));
    const collapsed = spread();

    await userEvent.hover(front());
    await waitFor(() =>
      expect(roots().every((root) => root.hasAttribute("data-stack"))).toBe(true),
    );
    await waitFor(() =>
      expect(spread()).toBeGreaterThan(collapsed + front().getBoundingClientRect().height),
    );
  });
});

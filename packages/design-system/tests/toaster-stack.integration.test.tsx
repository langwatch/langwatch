// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Toaster, toaster } from "../src/components/overlays/toaster.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

beforeEach(() => {
  toaster.remove();
  renderWithDesignSystem(<Toaster />);
});
afterEach(() => {
  cleanup();
  toaster.remove();
});

function roots(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-scope="toast"][data-part="root"]')];
}

function group(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[data-scope="toast"][data-part="group"]');
  if (!region) throw new Error("no toast region");
  return region;
}

const TYPES = ["success", "error", "warning", "info"] as const;
const typeOf = (title: string) => TYPES[Number(title.split(" ")[1]) % TYPES.length];

async function raise(count: number) {
  const titles = Array.from({ length: count }, (_, at) => `Notice ${at + 1}`);
  act(() => {
    for (const title of titles) toaster.create({ title, type: typeOf(title) });
  });
  await screen.findByText(titles.at(-1) ?? "");
}

describe("the shared toaster's stack", () => {
  describe("when several toasts are raised", () => {
    /** @scenario "A burst of toasts collapses into one stack" */
    it("overlaps them with the newest in front", async () => {
      await raise(3);

      expect(roots()).toHaveLength(3);
      for (const root of roots()) expect(root.hasAttribute("data-overlap")).toBe(true);
      const front = roots().find((root) => root.hasAttribute("data-first"));
      expect(front?.textContent).toContain("Notice 3");
    });
  });

  describe("when the pointer enters a collapsed stack", () => {
    /** @scenario "Reaching for the stack lists every card and holds every timer" */
    it("lists the cards and holds every timer until it leaves", async () => {
      await raise(3);

      fireEvent.mouseEnter(group());
      await waitFor(() => {
        for (const root of roots()) expect(root.hasAttribute("data-stack")).toBe(true);
      });
      for (const root of roots()) expect(root.hasAttribute("data-paused")).toBe(true);

      fireEvent.mouseLeave(group());
      await waitFor(() => {
        for (const root of roots()) expect(root.hasAttribute("data-overlap")).toBe(true);
      });
      for (const root of roots()) expect(root.hasAttribute("data-paused")).toBe(false);
    });
  });
});

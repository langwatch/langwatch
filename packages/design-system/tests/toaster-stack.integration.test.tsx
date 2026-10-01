// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Toaster, toaster } from "../src/components/toaster.tsx";
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
    /** @scenario "Reaching for the stack fans it out and holds every timer" */
    it("fans the cards out and holds every timer until it leaves", async () => {
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

  describe("when more toasts are raised than the stack shows", () => {
    /** @scenario "A stack says how many toasts wait behind it" */
    it("counts the ones waiting behind the front card", async () => {
      await raise(6);

      const chips = document.querySelectorAll("[data-toast-more]");
      expect(chips).toHaveLength(1);
      expect(chips[0]?.textContent).toBe("+3 more");
      expect(chips[0]?.closest("[data-first]")).not.toBeNull();
    });

    /** @scenario "A stack says how many toasts wait behind it" */
    it.each([1, 2, 3])("shows no count for %i toasts", async (count) => {
      await raise(count);

      expect(document.querySelector("[data-toast-more]")).toBeNull();
    });
  });

  describe("when a toast with a lifetime is raised", () => {
    /** @scenario "A toast shows the time it has left" */
    it("draws a lifetime bar, and none for a toast that stays", async () => {
      act(() => {
        toaster.create({ title: "Prompt saved", type: "success", duration: 4000 });
        toaster.create({ title: "Stays put", type: "info", duration: Number.POSITIVE_INFINITY });
        toaster.create({ title: "Running", type: "loading" });
      });
      const saved = (await screen.findByText("Prompt saved")).closest<HTMLElement>(
        '[data-part="root"]',
      );
      const stays = (await screen.findByText("Stays put")).closest<HTMLElement>(
        '[data-part="root"]',
      );
      const running = (await screen.findByText("Running")).closest<HTMLElement>(
        '[data-part="root"]',
      );

      expect(saved?.querySelector("[data-toast-lifetime]")).not.toBeNull();
      expect(stays?.querySelector("[data-toast-lifetime]")).toBeNull();
      expect(running?.querySelector("[data-toast-lifetime]")).toBeNull();
    });
  });
});

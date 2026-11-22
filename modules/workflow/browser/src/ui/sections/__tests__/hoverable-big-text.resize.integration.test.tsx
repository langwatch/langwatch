/**
 * HoverableBigText offers its tooltip and expand dialog only once it has measured itself as
 * clipped; a resize causes no render, so the box is watched as well.
 * @vitest-environment jsdom
 * @see specs/components/hoverable-big-text-overflow.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HoverableBigText } from "../hoverable-big-text.tsx";

const TEXT = "a very long value nobody can read in one line";
const MEASURE_DELAY_MS = 100;

type Watch = { element: Element; fire: () => void };

let watches: Watch[] = [];

/** A ResizeObserver whose callbacks the test fires by hand. */
class TestResizeObserver implements ResizeObserver {
  readonly #callback: ResizeObserverCallback;
  readonly #own: Watch[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe(element: Element) {
    const watch: Watch = { element, fire: () => this.#callback([], this) };
    this.#own.push(watch);
    watches.push(watch);
  }

  unobserve() {}

  disconnect() {
    watches = watches.filter((watch) => !this.#own.includes(watch));
  }
}

/** Make the box report more content than it can show, as clamping does. */
function clipContent({ element }: { element: HTMLElement }) {
  Object.defineProperty(element, "offsetHeight", { value: 40, configurable: true });
  Object.defineProperty(element, "scrollHeight", { value: 400, configurable: true });
}

describe("HoverableBigText overflow measurement", () => {
  beforeEach(() => {
    watches = [];
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("given the text fits its box when it is first laid out", () => {
    describe("when the box narrows without anything re-rendering it", () => {
      /** @scenario "Text clipped by a resize becomes readable again" */
      it("measures again and offers the hidden text", async () => {
        renderWithDesignSystem(<HoverableBigText>{TEXT}</HoverableBigText>);
        const box = screen.getByText(TEXT);
        await act(() => new Promise<void>((done) => setTimeout(done, MEASURE_DELAY_MS + 50)));
        fireEvent.click(box);
        expect(screen.queryByText("Formatted")).not.toBeInTheDocument();
        expect(box).not.toHaveAttribute("data-scope", "tooltip");

        clipContent({ element: box });
        const watch = watches.find((candidate) => candidate.element === box);
        if (!watch) throw new Error("the box is not watched for resizes");
        act(() => watch.fire());

        const clipped = screen.getByText(TEXT);
        expect(clipped).toHaveAttribute("data-scope", "tooltip");
        expect(clipped).toHaveAttribute("data-part", "trigger");
        fireEvent.click(clipped);
        expect(await screen.findByText("Formatted")).toBeInTheDocument();
      });
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * HoverableBigText only offers its tooltip and its expand dialog once it has
 * measured itself as clipped. The measurement runs after a render, and a
 * browser window resize causes no render, so a box that narrows underneath the
 * component keeps whatever answer the last render left behind: text clamps but
 * the tooltip stays disabled, and the hidden half becomes unreachable.
 *
 * Spec: specs/components/hoverable-big-text-overflow.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { HoverableBigText } from "../HoverableBigText";

const TEXT = "a very long value nobody can read in one line";

/** How long the component waits before measuring a freshly laid-out box. */
const MEASURE_DELAY_MS = 100;

type Watch = { element: Element; fire: () => void };

let watches: Watch[] = [];

/**
 * A ResizeObserver whose callbacks the test fires by hand, standing in for the
 * global no-op stub. Nothing else in jsdom reports a size change, so this is
 * the only way to say "the box got narrower" to a component that listens.
 */
class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  private readonly own: Watch[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    const watch: Watch = { element, fire: () => this.callback([], this) };
    this.own.push(watch);
    watches.push(watch);
  }

  unobserve() {
    // The component drops the whole observer on unmount, never one element.
  }

  disconnect() {
    watches = watches.filter((watch) => !this.own.includes(watch));
  }
}

/** Make the box report more content than it can show, as clamping does. */
const clipContent = (element: HTMLElement) => {
  Object.defineProperty(element, "offsetHeight", {
    value: 40,
    configurable: true,
  });
  Object.defineProperty(element, "scrollHeight", {
    value: 400,
    configurable: true,
  });
};

const renderText = () =>
  render(<HoverableBigText>{TEXT}</HoverableBigText>, {
    wrapper: ({ children }) => (
      <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
    ),
  });

/** Let the post-render measurement land, so the box starts out un-clipped. */
const settleFirstMeasurement = async () => {
  await act(
    () =>
      new Promise<void>((resolve) =>
        setTimeout(resolve, MEASURE_DELAY_MS + 50),
      ),
  );
};

const resizeBox = (box: HTMLElement) => {
  const watch = watches.find((candidate) => candidate.element === box);
  expect(watch, "the box must be watched for this test to mean anything").toBeDefined();
  act(() => watch!.fire());
};

describe("HoverableBigText overflow measurement", () => {
  const realResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    watches = [];
    globalThis.ResizeObserver =
      TestResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    cleanup();
    globalThis.ResizeObserver = realResizeObserver;
    vi.restoreAllMocks();
  });

  describe("given the text fits its box when it is first laid out", () => {
    describe("when the box narrows without anything re-rendering it", () => {
      /** @scenario Text clipped by a resize becomes readable again */
      it("measures again and offers the hidden text", async () => {
        renderText();
        const box = screen.getByText(TEXT);
        await settleFirstMeasurement();

        fireEvent.click(box);
        expect(
          screen.queryByText("Formatted"),
          "text that fits offers nothing to expand",
        ).not.toBeInTheDocument();

        clipContent(box);
        resizeBox(box);

        fireEvent.click(screen.getByText(TEXT));
        expect(await screen.findByText("Formatted")).toBeInTheDocument();
      });
    });
  });
});

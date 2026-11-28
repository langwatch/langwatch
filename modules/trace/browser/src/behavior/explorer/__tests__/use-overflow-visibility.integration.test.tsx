/**
 * The overflow measurement settles even when its caller hands it a new array of
 * the same ids on every render, as a component the compiler does not memoise does.
 * @see specs/traces-v2/trace-drawer-shell.feature
 */

import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOverflowVisibility } from "../use-overflow-visibility.ts";

const IDS = ["waterfall", "flame", "spans", "topology", "agents"];
const ITEM_WIDTH = 100;

let containerWidth = 0;
let renders = 0;
let lastHidden: ReadonlySet<string> = new Set();

function Row() {
  renders += 1;
  const ref = useRef<HTMLDivElement>(null);
  // A fresh array each render, the shape that used to loop the reset.
  const items = IDS.map((id) => id);
  lastHidden = useOverflowVisibility({
    scrollerRef: ref,
    items,
    activeId: "waterfall",
    reservePx: 0,
  });
  return (
    <div ref={ref} data-testid="row">
      {items.map((id) => (
        <span key={id} data-overflow-id={id} data-index={IDS.indexOf(id)} />
      ))}
    </div>
  );
}

beforeEach(() => {
  renders = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const index = this.dataset.index;
    if (index === undefined) {
      return { left: 0, right: containerWidth, width: containerWidth } as DOMRect;
    }
    const left = Number(index) * ITEM_WIDTH;
    return { left, right: left + ITEM_WIDTH, width: ITEM_WIDTH } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useOverflowVisibility", () => {
  /** @scenario "A tab row settles when its tabs do not fit" */
  it("folds the tabs past the edge and stops re-rendering when the row is too narrow", () => {
    containerWidth = 250;

    render(<Row />);

    expect([...lastHidden]).toEqual(["spans", "topology", "agents"]);
    expect(renders).toBeLessThan(10);
  });

  /** @scenario "A tab row settles when its tabs fit" */
  it("hides nothing and stops re-rendering when every tab fits", () => {
    containerWidth = 1000;

    render(<Row />);

    expect(lastHidden.size).toBe(0);
    expect(renders).toBeLessThan(10);
  });
});

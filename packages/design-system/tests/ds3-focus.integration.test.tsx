// @vitest-environment jsdom
/** Clear on the selection bar returns focus to the select-all box the header rebuilt. */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SelectionActionBar } from "../src/components/layout/selection-action-bar.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flushFrames = () => frames.splice(0).forEach((callback) => callback(0));

/** Clearing replaces the header's select-all, and the bar unmounts with zero selection. */
function Rebuilding({ disabled = false }: { disabled?: boolean }) {
  const [selected, setSelected] = useState(2);
  return (
    <>
      <table id="rows" aria-label="rows">
        <thead>
          <tr>
            <th key={selected}>
              <input
                type="checkbox"
                data-select-all=""
                aria-label="Select all"
                disabled={disabled}
              />
            </th>
          </tr>
        </thead>
      </table>
      <button type="button">Elsewhere</button>
      {selected > 0 && (
        <SelectionActionBar
          label={`${selected} selected`}
          placement="inline"
          forTable="rows"
          onClear={() => setSelected(0)}
        />
      )}
    </>
  );
}

describe("SelectionActionBar clear", () => {
  it("focuses the replacement select-all after the commit, not the detached one", () => {
    renderWithDesignSystem(<Rebuilding />);
    const original = screen.getByLabelText("Select all");
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    flushFrames();
    const replacement = screen.getByLabelText("Select all");
    expect(replacement).not.toBe(original);
    expect(document.activeElement).toBe(replacement);
  });

  it("does not steal focus the user moved to another control", () => {
    renderWithDesignSystem(<Rebuilding />);
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    flushFrames();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Elsewhere" }));
  });

  it("leaves a disabled select-all alone", () => {
    renderWithDesignSystem(<Rebuilding disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    flushFrames();
    expect(document.activeElement).not.toBe(screen.getByLabelText("Select all"));
  });

  it("is harmless when the table has gone", () => {
    renderWithDesignSystem(
      <SelectionActionBar label="1 selected" onClear={vi.fn()} forTable="missing" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(() => flushFrames()).not.toThrow();
  });
});

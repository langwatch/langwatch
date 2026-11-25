// VisibleOrderStrip maps visible indices to columnOrder indices,
// accounting for hidden columns.
// @vitest-environment jsdom
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { LensColumnOption } from "../../../../../../model/lens-capabilities.ts";
import { VisibleOrderStrip } from "../visible-order-strip.tsx";

afterEach(() => cleanup());

// Three visible columns. The `columnOrder` weaves in two hidden ids
// (`hidden-x`, `hidden-y`) at indices 1 and 3, so the visible-subset
// indices (0,1,2) do NOT line up with the columnOrder indices (0,2,4).
const VISIBLE: LensColumnOption[] = [
  { id: "time", label: "Time" },
  { id: "trace", label: "Trace" },
  { id: "duration", label: "Duration" },
];
const COLUMN_ORDER = ["time", "hidden-x", "trace", "hidden-y", "duration"];

const setup = () => {
  const reorderColumns = vi.fn();
  const onRemove = vi.fn();
  const utils = renderWithDesignSystem(
    <VisibleOrderStrip
      columns={VISIBLE}
      columnOrder={COLUMN_ORDER}
      reorderColumns={reorderColumns}
      onRemove={onRemove}
    />,
  );
  return { ...utils, reorderColumns, onRemove };
};

describe("<VisibleOrderStrip />", () => {
  describe("given a sparse columnOrder with hidden columns interleaved", () => {
    describe("when the user clicks Move Down on the first visible row", () => {
      it("fires reorderColumns with FULL-order indices (0 -> 2), not visible-subset (0 -> 1)", () => {
        const { getByLabelText, reorderColumns } = setup();
        fireEvent.click(getByLabelText("Move Time down"));
        expect(reorderColumns).toHaveBeenCalledTimes(1);
        expect(reorderColumns).toHaveBeenCalledWith(0, 2);
      });
    });

    describe("when the user clicks Move Up on the last visible row", () => {
      it("fires reorderColumns with FULL-order indices (4 -> 2), not visible-subset (2 -> 1)", () => {
        const { getByLabelText, reorderColumns } = setup();
        fireEvent.click(getByLabelText("Move Duration up"));
        expect(reorderColumns).toHaveBeenCalledTimes(1);
        expect(reorderColumns).toHaveBeenCalledWith(4, 2);
      });
    });

    describe("when the user clicks Move Up on the first visible row", () => {
      it("disables the button — no reorder fires", () => {
        const { getByLabelText, reorderColumns } = setup();
        const btn = getByLabelText("Move Time up");
        expect(btn).toBeDisabled();
        fireEvent.click(btn);
        expect(reorderColumns).not.toHaveBeenCalled();
      });
    });

    describe("when the user clicks Move Down on the last visible row", () => {
      it("disables the button — no reorder fires", () => {
        const { getByLabelText, reorderColumns } = setup();
        const btn = getByLabelText("Move Duration down");
        expect(btn).toBeDisabled();
        fireEvent.click(btn);
        expect(reorderColumns).not.toHaveBeenCalled();
      });
    });

    describe("when the user clicks Remove on a row", () => {
      it("fires onRemove with the column id", () => {
        const { getByLabelText, onRemove } = setup();
        fireEvent.click(getByLabelText("Remove Trace"));
        expect(onRemove).toHaveBeenCalledWith("trace");
      });
    });
  });
});

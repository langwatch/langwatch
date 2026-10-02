/**
 * Measured geometry in real Chromium, dark mode. Assertions run inside
 * `waitFor` so the stack's and the marker's transitions settle first.
 * @see packages/design-system/specs/shared-component-layout.feature
 */
import { VStack } from "@chakra-ui/react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { NoDataInfoBlock } from "../../src/components/no-data-info-block.tsx";
import { SegmentedControl } from "../../src/components/segmented-control.tsx";
import { STACK_DEPTH, Toaster, toaster } from "../../src/components/toaster.tsx";
import { renderWithDesignSystem } from "../../src/testing/index.tsx";

beforeAll(() => {
  document.documentElement.classList.add("dark");
  document.documentElement.style.colorScheme = "dark";
});

afterEach(() => {
  cleanup();
  toaster.remove();
});

function part({ scope, name }: { scope: string; name: string }): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(`[data-scope="${scope}"][data-part="${name}"]`),
  ];
}

function only({ scope, name }: { scope: string; name: string }): HTMLElement {
  const [found] = part({ scope, name });
  if (!found) throw new Error(`no ${scope} ${name}`);
  return found;
}

const indexOf = ({ element }: { element: HTMLElement }) =>
  Number(getComputedStyle(element).getPropertyValue("--index").trim());

const centreX = ({ rect }: { rect: DOMRect }) => rect.left + rect.width / 2;

describe("the toast stack", () => {
  describe("when four toasts collapse into a dark stack", () => {
    /** @scenario "The peeking cards of a dark toast stack measure evenly in a real browser" */
    it("steps the visible cards evenly, centres them and stands the count above the front", async () => {
      renderWithDesignSystem(<Toaster />);
      act(() => {
        for (let at = 1; at <= 4; at++) {
          toaster.create({ title: `Notice ${at}`, type: "info", duration: Infinity });
        }
      });
      await screen.findByText("Notice 4");

      await waitFor(
        () => {
          const visible = part({ scope: "toast", name: "root" })
            .filter((element) => indexOf({ element }) < STACK_DEPTH)
            .toSorted((a, b) => indexOf({ element: a }) - indexOf({ element: b }))
            .map((element) => element.getBoundingClientRect());
          expect(visible).toHaveLength(STACK_DEPTH);
          const [front, middle, back] = visible;
          if (!front || !middle || !back) throw new Error("stack incomplete");

          const firstStep = front.top - middle.top;
          expect(firstStep).toBeGreaterThan(0);
          expect(
            Math.abs(firstStep - (middle.top - back.top)),
            `card tops ${visible.map((rect) => rect.top).join(", ")}`,
          ).toBeLessThanOrEqual(1);
          for (const card of [middle, back]) {
            expect(
              Math.abs(centreX({ rect: card }) - centreX({ rect: front })),
            ).toBeLessThanOrEqual(1);
          }

          const pill = document.querySelector("[data-toast-more]");
          if (!pill) throw new Error("no count pill");
          expect(pill.getBoundingClientRect().bottom).toBeLessThanOrEqual(front.top);
        },
        { timeout: 3000 },
      );
    });
  });
});

describe("the segmented control", () => {
  describe("when the middle of three options is selected in dark mode", () => {
    /** @scenario "The marker of a dark segmented control measures evenly in a real browser" */
    it("insets the marker evenly and lays it over the selected option", async () => {
      renderWithDesignSystem(<SegmentedControl items={["Day", "Week", "Month"]} value="Week" />);
      await screen.findByText("Week");

      await waitFor(() => {
        const root = only({ scope: "segment-group", name: "root" }).getBoundingClientRect();
        const marker = only({ scope: "segment-group", name: "indicator" }).getBoundingClientRect();
        const items = part({ scope: "segment-group", name: "item" });
        const first = items.at(0)?.getBoundingClientRect();
        const last = items.at(-1)?.getBoundingClientRect();
        const selected = items.find((item) => item.dataset.state === "checked");
        if (!first || !last || !selected) throw new Error("no items");

        const inset = marker.top - root.top;
        expect(inset).toBeGreaterThan(0);
        expect(Math.abs(root.bottom - marker.bottom - inset)).toBeLessThanOrEqual(1);
        expect(Math.abs(first.left - root.left - inset)).toBeLessThanOrEqual(1);
        expect(Math.abs(root.right - last.right - inset)).toBeLessThanOrEqual(1);

        const option = selected.getBoundingClientRect();
        expect(Math.abs(marker.left - option.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(marker.right - option.right)).toBeLessThanOrEqual(1);
      });
    });
  });
});

describe("the empty state", () => {
  describe("when it sits in an 800px start-aligned column in dark mode", () => {
    /** @scenario "A dark empty state measures as wide as its start-aligned container" */
    it("is as wide as the column with its title on the column's centre line", async () => {
      renderWithDesignSystem(
        <VStack align="start" width="800px" data-testid="column">
          <NoDataInfoBlock
            testId="empty"
            title="No traces yet"
            description="Send your first trace to see it here."
            icon={<span />}
          />
        </VStack>,
      );

      const column = (await screen.findByTestId("column")).getBoundingClientRect();
      const empty = screen.getByTestId("empty").getBoundingClientRect();
      const title = screen.getByText("No traces yet").getBoundingClientRect();

      expect(column.width).toBe(800);
      expect(Math.abs(empty.width - column.width)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(centreX({ rect: title }) - centreX({ rect: column }))).toBeLessThanOrEqual(2);
    });
  });
});

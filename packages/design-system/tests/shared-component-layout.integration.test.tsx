import { Box } from "@chakra-ui/react";
// @vitest-environment jsdom
/**
 * jsdom has no layout, so these read the CSS each element is given. Measured
 * geometry needs a real browser; no browser lane exists for this package yet.
 * @see packages/design-system/specs/shared-component-layout.feature
 */
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NoDataInfoBlock } from "../src/components/no-data-info-block.tsx";
import { SegmentedControl } from "../src/components/segmented-control.tsx";
import { Toaster, toaster } from "../src/components/toaster.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => {
  cleanup();
  toaster.remove();
});

/** Every injected rule whose selector names one of the element's own classes. */
function rulesFor({ element }: { element: Element }): string {
  const css = [...document.querySelectorAll("style")].map((style) => style.innerHTML).join("\n");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  return [...element.classList]
    .flatMap((name) => rules.filter((rule) => rule[1]?.includes(`.${name}`)))
    .map((rule) => `${rule[1]?.trim()}{${rule[2]}}`)
    .join("\n");
}

function part({ scope, name }: { scope: string; name: string }): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-scope="${scope}"][data-part="${name}"]`);
  if (!found) throw new Error(`no ${scope} ${name}`);
  return found;
}

async function raiseToasts({ count }: { count: number }) {
  renderWithDesignSystem(<Toaster />);
  act(() => {
    for (let at = 1; at <= count; at++) toaster.create({ title: `Notice ${at}`, type: "info" });
  });
  await screen.findByText(`Notice ${count}`);
}

describe("the toast stack", () => {
  describe("when three toasts collapse into a stack", () => {
    /** @scenario "Cards behind the front toast peek out in even steps" */
    it("scales every card from its top edge and hides the text of the ones behind", async () => {
      await raiseToasts({ count: 3 });

      const css = rulesFor({ element: part({ scope: "toast", name: "root" }) });
      expect(css).toMatch(/\[data-overlap\][^{]*\{[^}]*transform-origin:top center/);
      expect(css).toMatch(/\[data-overlap\]:not\(\[data-first\]\)>\*\{[^}]*opacity:0/);
    });
  });

  describe("when more toasts wait than the stack shows", () => {
    /** @scenario "The count of waiting toasts clears the front card's edge" */
    it("stands the count above the front card instead of across its border", async () => {
      await raiseToasts({ count: 5 });

      const chip = document.querySelector("[data-toast-more]");
      if (!chip) throw new Error("no count chip");
      const css = rulesFor({ element: chip });
      expect(css).toContain("bottom:100%");
      expect(css).not.toContain("translate:0 -50%");
      expect(chip.closest("[data-first]")).not.toBeNull();
    });
  });
});

describe("the segmented control", () => {
  describe("when an option is selected", () => {
    /** @scenario "The selected segment sits evenly inside the segmented control" */
    it("insets the marker evenly and shares one corner radius with the options", async () => {
      renderWithDesignSystem(<SegmentedControl items={["Day", "Week", "Month"]} value="Week" />);

      const root = rulesFor({ element: part({ scope: "segment-group", name: "root" }) });
      expect(root).toContain("padding:2px");
      expect(root).toContain("--segment-radius:var(--chakra-radii-md)");

      const indicator = rulesFor({ element: part({ scope: "segment-group", name: "indicator" }) });
      expect(indicator).toContain("top:var(--top)");
      expect(indicator).toContain("left:var(--left)");
      expect(indicator).toContain("border-radius:var(--segment-radius)");

      const selected = await screen.findByText("Week");
      expect(selected.closest('[data-state="checked"]')).not.toBeNull();
    });
  });
});

describe("the empty state", () => {
  describe("when its container aligns children to the start", () => {
    /** @scenario "An empty state fills the width of its container with centred text" */
    it("stretches across the container and centres its text", async () => {
      renderWithDesignSystem(
        <Box display="flex" flexDirection="column" alignItems="flex-start">
          <NoDataInfoBlock
            testId="empty"
            title="No traces yet"
            description="Send your first trace to see it here."
            icon={<span />}
          />
        </Box>,
      );

      expect(rulesFor({ element: await screen.findByTestId("empty") })).toContain(
        "align-self:stretch",
      );
      const content = screen.getByText("No traces yet").closest(".chakra-empty-state__content");
      if (!content) throw new Error("no empty-state content");
      expect(rulesFor({ element: content })).toContain("text-align:center");
    });
  });
});

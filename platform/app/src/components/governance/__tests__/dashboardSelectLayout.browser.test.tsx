/**
 * Real-Chromium layout tests for the governance dashboard's one choice control.
 *
 * WHY THIS FILE EXISTS, and it is worth reading before adding to it.
 *
 * `DashboardSelect` once rendered Chakra's `Select.Content` with no
 * `Select.Positioner`. The floating-ui styles that lift a dropdown out of the
 * document and anchor it to its trigger ride entirely on the positioner, so
 * without one the list is not a dropdown at all: it lays out in normal flow and
 * shoves the rest of the form down as it opens.
 *
 * Every jsdom test of that control passed, including a deliberate falsification
 * that proved they could detect a native `<select>`. They passed because jsdom
 * performs no layout: a positioned tree and an unpositioned tree are
 * byte-identical to it, and `getBoundingClientRect` answers zero for everything.
 * No amount of care in a jsdom suite could have caught this. A real engine is
 * the only instrument that can see it, which is the whole reason for this file.
 *
 * So the assertions here are deliberately NOT about markup. They are about
 * geometry and hit-testing, the two things only a browser knows:
 *
 *   1. Opening the list does not move the field below it. That is what
 *      "out of normal flow" means when a human looks at the screen.
 *   2. The list is the topmost element at its own centre while the drawer is
 *      open. That is what "clickable" means, and it is the z-index case the
 *      house wrapper exists to fix, since every call site is inside a drawer.
 *
 * It lives under `src/` because the browser runner only globs `src/**`, and it
 * imports the control through the `@ee/` alias the browser config already
 * defines rather than widening that glob for one file.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { DashboardSelect } from "@ee/governance/dashboard/components/DashboardSelect";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { Drawer } from "~/components/ui/drawer";

const FREQUENCIES = [
  { label: "Every 15 minutes", value: "m15" },
  { label: "Every hour", value: "hourly" },
  { label: "Every day", value: "daily" },
];

/**
 * The control with a field under it, which is the shape every real call site
 * has: the cadence picker sits above the rest of the drawer, and the rule
 * composer's pickers sit above the rest of the composer.
 *
 * The marker below is what tells us whether the list pushed the form apart.
 */
function Harness() {
  const [value, setValue] = useState("m15");
  return (
    <div style={{ padding: 24, width: 420 }}>
      <DashboardSelect
        ariaLabel="Frequency"
        options={FREQUENCIES}
        value={value}
        onChange={setValue}
      />
      <p data-testid="field-below">The field that follows the picker</p>
    </div>
  );
}

/**
 * The same control inside the app's own drawer, which is where all six of the
 * real ones live. This uses `~/components/ui/drawer` rather than a hand-rolled
 * dialog on purpose: the stacking problem the wrapper's z-index override
 * exists to solve is created by the drawer's layer, so a synthetic dialog
 * would be testing a different question.
 */
function DrawerHarness() {
  const [value, setValue] = useState("m15");
  return (
    <Drawer.Root open placement="end" size="md">
      <Drawer.Content>
        <Drawer.Body>
          <DashboardSelect
            ariaLabel="Frequency"
            options={FREQUENCIES}
            value={value}
            onChange={setValue}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

const mount = (ui: React.ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);

const trigger = () => screen.getByRole("combobox", { name: "Frequency" });

afterEach(cleanup);

describe("given the governance dashboard's choice control in a real browser", () => {
  describe("when the list is opened", () => {
    /** @scenario "No governance page renders a native select" */
    it("floats the list instead of pushing the rest of the form down", async () => {
      mount(<Harness />);
      const below = screen.getByTestId("field-below");
      const before = below.getBoundingClientRect().top;

      await userEvent.click(trigger());
      await waitFor(() =>
        expect(screen.getByRole("option", { name: "Every day" })).toBeVisible(),
      );

      // The one assertion jsdom could never make. On the version without a
      // positioner this moved by the full height of the list.
      expect(below.getBoundingClientRect().top).toBe(before);
    });

    /** @scenario "No governance page renders a native select" */
    it("anchors the list to the trigger rather than the top of the page", async () => {
      mount(<Harness />);
      await userEvent.click(trigger());
      const option = await screen.findByRole("option", {
        name: "Every 15 minutes",
      });

      const list = option.closest("[role='listbox']");
      expect(list).not.toBeNull();
      const listBox = list!.getBoundingClientRect();
      const triggerBox = trigger().getBoundingClientRect();

      // Taken out of the document's flow, which is the property that makes it a
      // dropdown. Checking the coordinates alone is NOT enough and this was
      // measured, not assumed: a list left in normal flow lands at the same
      // left edge and just under the trigger anyway, so the two deltas below
      // pass on the broken build. The computed position is what separates
      // "floating above the form" from "wedged into it".
      const positioner = list!.parentElement;
      expect(positioner).not.toBeNull();
      expect(["absolute", "fixed"]).toContain(
        getComputedStyle(positioner!).position,
      );

      // Anchored to its own trigger rather than parked at the corner of the
      // page, which is the other half of what the positioner buys.
      expect(Math.abs(listBox.left - triggerBox.left)).toBeLessThan(4);
      expect(Math.abs(listBox.top - triggerBox.bottom)).toBeLessThan(24);
    });
  });

  describe("when the control is inside the drawer", () => {
    /** @scenario "No governance page renders a native select" */
    it("paints the list above the drawer so its options can be clicked", async () => {
      mount(<DrawerHarness />);
      await userEvent.click(trigger());
      const option = await screen.findByRole("option", { name: "Every hour" });

      const box = option.getBoundingClientRect();
      const topmost = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );

      // Hit-testing, not z-index arithmetic. Asserting a computed z-index
      // would pass on a list that some other stacking context still covers;
      // asking the browser what is actually under the cursor cannot.
      expect(topmost).not.toBeNull();
      expect(option.contains(topmost) || option === topmost).toBe(true);
    });

    /** @scenario "No governance page renders a native select" */
    it("lets a click on an option actually choose it", async () => {
      mount(<DrawerHarness />);
      await userEvent.click(trigger());
      await userEvent.click(
        await screen.findByRole("option", { name: "Every day" }),
      );

      // The end-to-end proof that the two assertions above are about something
      // that matters: if the list were behind the drawer, this click would land
      // on the drawer and the trigger would still read its old value.
      await waitFor(() => expect(trigger()).toHaveTextContent("Every day"));
    });
  });
});

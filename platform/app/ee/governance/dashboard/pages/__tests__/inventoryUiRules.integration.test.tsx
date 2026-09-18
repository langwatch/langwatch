// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The rules the whole governance section follows, checked on this page.
 *
 * These are claims about the screen rather than about any one pane — where
 * the page actions sit, what weight they carry, and that no native select
 * appears anywhere, drawers and dialogs included. A pane test can see neither
 * the header nor the drawers, so they are asserted here.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import "@testing-library/jest-dom/vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  connectTools,
  emptyWithSamplesOff,
  findNativeSelects,
  harness,
  openTab,
  renderScreen,
  renderScreenWithReferences,
} from "./inventoryScreenHarness";

describe("given an admin on the Inventory page", () => {
  describe("when the section's shared UI rules are checked", () => {
    /*
     * Position is asserted structurally rather than by pixel: the actions are
     * the last child of the header row, which is what puts them at its right
     * end under `justify="space-between"`, and jsdom lays nothing out.
     */
    /** @scenario "Primary page actions sit top-right in the page header" */
    it("puts the page actions at the right of the header, small, one solid", async () => {
      connectTools();
      renderScreenWithReferences();
      const heading = screen.getByRole("heading", { name: "Inventory" });
      const headerRow = heading.closest("div")?.parentElement;
      expect(headerRow).not.toBeNull();
      const actions = headerRow?.lastElementChild;
      const sampleToggle = screen.getByRole("button", {
        name: "See sample data",
      });
      const addTool = screen.getAllByRole("button", { name: /Add tool/ })[0]!;
      expect(actions?.contains(sampleToggle)).toBe(true);
      expect(actions?.contains(addTool)).toBe(true);

      const ghostSmall = screen.getByText("reference ghost small").className;
      const subtleSmall = screen.getByText("reference subtle small").className;
      const solidSmall = screen.getByText("reference solid small").className;
      const solidSmallTrigger = screen.getByText(
        "reference solid small trigger",
      ).className;

      // The old assertion here was `addTool.className !== sampleToggle.className`,
      // which is satisfied by any two buttons that differ at all. A grey Add
      // tool passed it exactly as happily as the solid orange one the page
      // actually renders, so it could not catch the drift it was written for.
      //
      // Adding a tool is the only action here that registers something of the
      // organization's own, so it is the solid one.
      expect(addTool.className).toBe(solidSmallTrigger);
      // Ghost rather than outline: the toggle changes what the page shows
      // rather than anything about the organization.
      expect(sampleToggle.className).toBe(ghostSmall);

      // Exactly one solid, not "at most one". A header where nothing is solid
      // reads as a header with no primary action.
      const headerButtons = actions
        ? Array.from(actions.querySelectorAll("button"))
        : [];
      expect(
        headerButtons.filter(
          (button) =>
            button.className === solidSmall ||
            button.className === solidSmallTrigger,
        ),
      ).toHaveLength(1);

      // Pressed, the kit draws the toggle subtle rather than ghost, so that a
      // page showing invented figures says so in the control that caused it.
      // Asserting only the resting state would leave the louder of the two
      // states unchecked, which is the state that matters.
      await userEvent.click(sampleToggle);
      const pressedToggle = await screen.findByRole("button", {
        name: "Hide sample data",
      });
      expect(pressedToggle.className).toBe(subtleSmall);
      // Never solid in either state. Solid is reserved for the action that
      // creates something of the organization's own, and looking at invented
      // data is not that.
      expect(pressedToggle.className).not.toBe(solidSmall);
      expect(ghostSmall).not.toBe(subtleSmall);
    });

    // Swept across the WHOLE screen, not inside the header. Sweeping only the
    // header is what would have missed the defect this rule was written for:
    // the second control was down in the sources table's own header, and every
    // assertion scoped to the page header agreed the page was fine.
    //
    // Label AND weight, because the defect was both. A solid "Add tool" up top
    // beside an outline "Add source" below gave one flow two names and two
    // weights. Asserting only the count would forbid an empty state from
    // repeating the header's own action, which the shared empty state is built
    // to allow and which Agents does.
    /** @scenario "A page offers one create flow, under one label, from its header" */
    it("gives the create flow one label and one weight on each pane, from the header", async () => {
      connectTools();
      renderScreen();

      const createControls = () =>
        screen.queryAllByRole("button", { name: /Add (tool|source)/ });
      const heading = screen.getByRole("heading", { name: "Inventory" });
      const headerRow = heading.closest("div")?.parentElement;

      const assertOneDoor = (expectedLabel: string) => {
        const controls = createControls();
        expect(controls.length).toBeGreaterThan(0);
        for (const control of controls) {
          expect(control).toHaveTextContent(expectedLabel);
        }
        // One weight: every control opening this flow renders identically.
        const weights = new Set(controls.map((c) => c.className));
        expect(weights.size).toBe(1);
        // And the flow is reachable from the header, not only from the content.
        expect(controls.some((c) => headerRow?.contains(c))).toBe(true);
      };

      assertOneDoor("Add tool");

      await openTab(/Sources/);

      // The sources table used to add its own, differently-worded control, so
      // this is the pane the rule exists for.
      assertOneDoor("Add source");
    });

    // The catalog with nothing in it, and the samples turned off, which is the
    // only combination that shows a reader their own empty catalog.
    /** @scenario "An empty pane explains itself rather than sitting blank" */
    it("draws the shared empty state on an empty catalog, glyph, headline and sentence", async () => {
      emptyWithSamplesOff();
      renderScreen();

      const empty = screen.getByTestId("tool-catalog-empty");
      expect(
        within(empty).getByText("No tools registered yet"),
      ).toBeInTheDocument();
      // The sentence says what fills the catalog. Asserted because a headline
      // alone is the old grey-box empty state wearing a bigger font.
      expect(within(empty).getByText(/joins the catalog/)).toBeInTheDocument();
      // The glyph. The scenario names it, and a shared empty state that
      // silently dropped it would still pass on headline and sentence alone.
      expect(empty.querySelector("svg")).not.toBeNull();
      // Never the dashed box this replaced. Dashes read as a drop target or a
      // component that failed to arrive, which is what the owner reported.
      expect(empty).not.toHaveStyle({ borderStyle: "dashed" });
      // The empty state offers the way out, and offers it under the HEADER'S
      // label rather than a new one. The sentence used to name the button in
      // prose instead ("with Add tool, above"), which pointed at a control by
      // a name nothing checked: rename the header and the sentence lies, and
      // no rule about controls can catch a stale sentence.
      const inside = within(empty).getByRole("button", { name: /Add tool/ });
      const header = screen
        .getByRole("heading", { name: "Inventory" })
        .closest("div")?.parentElement;
      const inHeader = within(header as HTMLElement).getByRole("button", {
        name: /Add tool/,
      });
      expect(inside).not.toBe(inHeader);
      // Same label and same weight.
      expect(inside.className).toBe(inHeader.className);
      // And same FLOW, which label and weight alone do not prove: two
      // identically-drawn buttons can still lead to different places, and that
      // would be the original defect wearing a matching coat. Followed all the
      // way to the composer, because both controls own a menu and asserting
      // only that a menu opened would accept two menus onto two flows.
      //
      // Scoped to the menu that this press opened, not to the screen: both
      // triggers mount their own menu content, so a page-level query for a
      // menu item finds two and cannot say which trigger opened one. The
      // trigger reporting itself expanded is what ties the open menu to it.
      await userEvent.click(inside);
      expect(inside).toHaveAttribute("aria-expanded", "true");
      expect(inHeader).toHaveAttribute("aria-expanded", "false");
      const menus = await screen.findAllByRole("menu");
      const open = menus.filter((m) => m.dataset.state === "open");
      expect(open).toHaveLength(1);
      await userEvent.click(
        within(open[0] as HTMLElement).getByRole("menuitem", {
          name: /Anthropic Admin API/,
        }),
      );
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    // A reader who cannot create must not be told to press a button that is
    // not on their screen. The sentence changes with the grant, which is the
    // only part of the empty state that may.
    /** @scenario "An empty pane explains itself rather than sitting blank" */
    it("does not point a read-only viewer at a create control they cannot see", () => {
      harness.permissions = [
        "organization:view",
        "governance:view",
        "ingestionSources:view",
      ];
      emptyWithSamplesOff();
      renderScreen();

      const empty = screen.getByTestId("tool-catalog-empty");
      expect(
        within(empty).getByText(/someone connects it/),
      ).toBeInTheDocument();
      // Neither the sentence nor the action offers a create. The empty state
      // drops its action with the grant, so a viewer gets an explanation and
      // no button, rather than a button that would fail on press.
      expect(within(empty).queryByRole("button")).toBeNull();
      expect(screen.queryByRole("button", { name: /Add tool/ })).toBeNull();
    });

    /*
     * Every pane, and both drawers that carry choice controls.
     *
     * The narrow version of this test opened one drawer on one source type and
     * proved almost nothing: "Custom S3 audit log" has no pull adapter, so the
     * cadence field never mounted, and the anomaly-rule composer was never
     * reached at all. Four native selects and a Chakra NativeSelect survived
     * underneath a passing assertion. So this walks every tab and opens the
     * drawer on a PULL-BASED type, which is the only way the cadence field
     * renders.
     *
     * The composer's own four selects left this page with the Anomaly rules
     * tab. They are still swept, in the component test beside the tab itself:
     * ee/governance/dashboard/components/__tests__/anomalyRulesComposer.integration.test.tsx.
     */
    /** @scenario "No governance page renders a native select" */
    it("renders no native select on any tab, empty or full", async () => {
      // Say which state this half is in rather than inheriting it. The unset
      // sample choice already resolves to the reader's own data, so this half
      // was empty as written; pinning it means the sweep keeps sweeping an
      // empty page if that default is ever flipped to offer samples to an
      // empty org, instead of quietly becoming a second populated sweep.
      emptyWithSamplesOff();
      const { unmount } = renderScreen();
      for (const tab of [/Environments/, /Sources/, /Catalog/]) {
        await openTab(tab);
        expect(findNativeSelects(document.body)).toHaveLength(0);
      }
      // Proof this half is actually empty, so a future change to the default
      // sample choice cannot quietly turn it back into a second full sweep
      // while every assertion above still passes.
      //
      // Awaited, not queried outright: `openTab` returns once the tab reports
      // itself selected, which is earlier than the pane it reveals finishing
      // its own render. The synchronous form passed on a warm local machine
      // and failed on a loaded CI worker.
      expect(
        await screen.findByTestId("tool-catalog-empty"),
      ).toBeInTheDocument();
      unmount();

      connectTools();
      renderScreen();
      // Catalog belongs in the populated sweep too, and for a while it was
      // the only pane missing from it — the one that actually renders cards
      // and their controls, on the half of the test where there is something
      // to render. The title says "empty or full"; this is the full half.
      for (const tab of [/Environments/, /Sources/, /Catalog/]) {
        await openTab(tab);
        expect(findNativeSelects(document.body)).toHaveLength(0);
      }
      // And the matching proof for this half: connected tools really did put
      // cards on the catalog. Without it a sweep over two empty pages would
      // satisfy every assertion above and still test nothing.
      //
      // The card is awaited FIRST and the empty state checked second, because
      // the absence on its own proves nothing — a pane that has not rendered
      // yet is also missing its empty state, and the pair would pass on a
      // catalog that never arrived.
      expect(
        await screen.findByTestId("tool-card-src-genie"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("tool-catalog-empty")).toBeNull();
    });

    /*
     * `anthropic_admin` is chosen deliberately: it has a pull adapter, so the
     * cadence field mounts. A push-only type skips it and the assertion goes
     * quiet again.
     */
    /** @scenario "No governance page renders a native select" */
    it("renders no native select in the source drawer, cadence field and all", async () => {
      connectTools();
      renderScreen();
      await userEvent.click(
        screen.getAllByRole("button", { name: /Add tool/ })[0]!,
      );
      await userEvent.click(
        await screen.findByRole("menuitem", { name: /Anthropic Admin API/ }),
      );
      await screen.findByRole("dialog");
      // Required, not probed. `anthropic_admin` always puts PullCadenceField
      // behind Advanced, so the old `if (advanced)` never fired — it only
      // stood ready to swallow a rename, dropping the group out of the sweep
      // below while the test stayed green.
      await userEvent.click(screen.getByRole("button", { name: /Advanced/ }));
      // Prove the cadence field is actually on screen before declaring it
      // native-free. Without this the test passes just as loudly on a drawer
      // that never rendered the control, which is how the narrow version of
      // this assertion went green over five native selects.
      expect(
        screen.getByRole("combobox", { name: "Frequency" }),
      ).toBeInTheDocument();
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });
});

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
import { PageLayout } from "@langwatch/design-system/page-layout";
import "@testing-library/jest-dom/vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AddIngestionSourceMenu } from "../../../../features/ingestion-sources/ui/elements/add-ingestion-source-menu.tsx";
import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import {
  connectTools,
  emptyWithSamplesOff,
  findNativeSelects,
  harness,
  openTab,
  renderScreen,
  renderScreenWithReferences,
} from "./inventoryScreenHarness";

/**
 * The header's own buttons of known weight, drawn in a header of their own so
 * the page's controls are compared with the same size and palette.
 */
function renderHeaderReferences() {
  renderWithGovernanceHost(
    <PageLayout.Header>
      <PageLayout.Heading>references</PageLayout.Heading>
      <PageLayout.HeaderButton primary>primary reference</PageLayout.HeaderButton>
      <PageLayout.HeaderButton>outline reference</PageLayout.HeaderButton>
      <AddIngestionSourceMenu isEnterprise onPick={() => undefined}>
        <PageLayout.HeaderButton primary>primary trigger reference</PageLayout.HeaderButton>
      </AddIngestionSourceMenu>
      <AddIngestionSourceMenu isEnterprise onPick={() => undefined}>
        <PageLayout.HeaderButton>outline trigger reference</PageLayout.HeaderButton>
      </AddIngestionSourceMenu>
    </PageLayout.Header>,
    { host: fakeGovernanceHost() },
  );
  const text = (name: string) => screen.getByText(name).closest("button")!.className;
  return {
    primary: text("primary reference"),
    outline: text("outline reference"),
    primaryTrigger: text("primary trigger reference"),
    outlineTrigger: text("outline trigger reference"),
  };
}

describe("given an admin on the Inventory page", () => {
  describe("when the section's shared UI rules are checked", () => {
    /*
     * Position is asserted structurally rather than by pixel: the actions are
     * the last child of the header row, which is what puts them at its right
     * end under `justify="space-between"`, and jsdom lays nothing out.
     */
    /** @scenario "Primary page actions sit top-right in the page header" */
    /** @scenario "The sample toggle sits top-right and the banner directly under the header" */
    it("puts the page actions at the right of the header, small, none solid", async () => {
      connectTools();
      renderScreenWithReferences();
      const refs = renderHeaderReferences();
      const heading = screen.getByRole("heading", { name: "Inventory" });
      const headerRow = heading.closest("div");
      expect(headerRow).not.toBeNull();
      const actions = headerRow?.lastElementChild;
      const sampleToggle = screen.getByRole("button", {
        name: "See sample data",
      });
      const addSource = screen.getAllByRole("button", {
        name: /Add source/,
      })[0]!;
      expect(actions?.contains(sampleToggle)).toBe(true);
      expect(actions?.contains(addSource)).toBe(true);

      const ghostSmall = screen.getByText("reference ghost small").className;
      const subtleSmall = screen.getByText("reference subtle small").className;
      const solidSmall = screen.getByText("reference solid small").className;

      // The references must differ or the comparisons below prove nothing. The
      // header draws even its primary button outline, so solid is the one to avoid.
      expect(refs.outline).not.toBe(solidSmall);
      expect(refs.outline).not.toBe(ghostSmall);
      expect(refs.primary).toBe(refs.outline);
      expect(refs.primaryTrigger).toBe(refs.outlineTrigger);
      // The create action is the house header button, outline, and the toggle
      // beside it is ghost: the toggle changes what the page shows rather than
      // anything about the organization.
      expect(addSource.className).toBe(refs.outlineTrigger);
      expect(sampleToggle.className).toBe(ghostSmall);

      // Exactly one outline, which is what marks the create action out, and
      // nothing solid in the row, in the branded or the plain form.
      const headerButtons = actions ? Array.from(actions.querySelectorAll("button")) : [];
      expect(
        headerButtons.filter(
          (button) => button.className === refs.outline || button.className === refs.outlineTrigger,
        ),
      ).toHaveLength(1);
      expect(headerButtons.filter((button) => button.className === solidSmall)).toHaveLength(0);

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
    // Label AND weight, because the defect was both: a solid create up top
    // beside an outline one below gave one flow two names and two weights.
    // Asserting only the count would forbid an empty state from repeating the
    // header's own action, which the shared empty state is built to allow and
    // which Agents does.
    /** @scenario "A page offers one create flow, under one label, from its header" */
    it("gives the create flow one label and one weight on each pane, from the header", async () => {
      connectTools();
      renderScreen();

      const createControls = () => screen.queryAllByRole("button", { name: /Add (tool|source)/ });
      const heading = screen.getByRole("heading", { name: "Inventory" });
      const headerRow = heading.closest("div");

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

      assertOneDoor("Add source");

      await openTab(/Environments/);
      assertOneDoor("Add source");

      await openTab(/Sources/);

      // The sources table repeats the header's control in its own header, so
      // this is the pane the rule exists for.
      assertOneDoor("Add source");
    });

    /** @scenario "Primary page actions sit top-right in the page header" */
    it("keeps Add source outline on Catalog and Sources and Add environment outline beside it on Environments", async () => {
      connectTools();
      renderScreen();
      const header = () =>
        screen.getByRole("heading", { name: "Inventory" }).closest("div")
          ?.parentElement as HTMLElement;
      const addSource = () => within(header()).getByRole("button", { name: /Add source/ });
      const refs = renderHeaderReferences();

      expect(addSource().className).toBe(refs.outlineTrigger);

      await openTab(/Environments/);
      const addEnvironment = within(header()).getByRole("button", { name: /Add environment/ });
      // Both stay reachable and outline: no solid fill competes in the row.
      expect(addSource()).toBeEnabled();
      expect(addSource().className).toBe(refs.outlineTrigger);
      expect(addEnvironment.className).toBe(refs.outline);

      await openTab(/Sources/);
      expect(addSource().className).toBe(refs.outlineTrigger);
      expect(within(header()).queryByRole("button", { name: /Add environment/ })).toBeNull();
    });

    // A source is where what the inventory lists arrives from, so connecting
    // one is the page's create wherever the reader is standing. The registry
    // used to offer its own "Add tool" beside it on the catalog pane, which
    // gave the page two creates and the reader a choice to make.
    /** @scenario "The inventory header offers Add source on every tab and no Add tool" */
    it("offers Add source in the header on every tab, and no Add tool anywhere", async () => {
      connectTools();
      renderScreen();

      const header = () =>
        screen.getByRole("heading", { name: "Inventory" }).closest("div")
          ?.parentElement as HTMLElement;
      for (const tab of [/Catalog/, /Environments/, /Sources/]) {
        await openTab(tab);
        expect(within(header()).getByRole("button", { name: /Add source/ })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Add tool/ })).toBeNull();
      }
    });

    // The catalog with nothing in it, and the samples turned off, which is the
    // only combination that shows a reader their own empty catalog.
    /** @scenario "An empty pane explains itself rather than sitting blank" */
    it("draws the shared empty state on an empty catalog, glyph, headline and sentence", async () => {
      emptyWithSamplesOff();
      renderScreen();

      const empty = screen.getByTestId("tool-catalog-empty");
      expect(within(empty).getByText("No tools registered yet")).toBeInTheDocument();
      // The sentence says what fills the catalog. Asserted because a headline
      // alone is the old grey-box empty state wearing a bigger font.
      expect(
        within(empty).getByText(/Register the AI tools this organization runs/),
      ).toBeInTheDocument();
      // The glyph. The scenario names it, and a shared empty state that
      // silently dropped it would still pass on headline and sentence alone.
      expect(empty.querySelector("svg")).not.toBeNull();
      // Never the dashed box this replaced. Dashes read as a drop target or a
      // component that failed to arrive, which is what the owner reported.
      expect(empty).not.toHaveStyle({ borderStyle: "dashed" });
      // No create of its own inside the empty state: the page's one create is
      // Add source in the header, and a control here that registered a tool
      // would be a second door under another name.
      expect(within(empty).queryByRole("button")).toBeNull();
      const header = screen
        .getByRole("heading", { name: "Inventory" })
        .closest("div")?.parentElement;
      expect(
        within(header as HTMLElement).getByRole("button", {
          name: /Add source/,
        }),
      ).toBeInTheDocument();
    });

    // A reader without the registry grant must not be shown an empty catalog
    // and told their organization runs nothing. The pane says which grant it
    // needs instead, with the tab strip still in place.
    /** @scenario "The catalog stays hidden from a reader without the registry grant" */
    it("tells a reader without the registry grant which grant the catalog needs", () => {
      harness.permissions = ["organization:view", "governance:view", "ingestionSources:view"];
      emptyWithSamplesOff();
      renderScreen();

      // Not the empty state: "no tools registered yet" would be a confident
      // wrong answer where the honest one is that they cannot see.
      expect(screen.queryByTestId("tool-catalog-empty")).toBeNull();
      expect(screen.getByText(/aiTools:manage/)).toBeInTheDocument();
      // And no create control they could press and be refused.
      expect(screen.queryByRole("button", { name: /Add tool/ })).toBeNull();
      // The tab strip survives, so the reader can still reach the panes they
      // do hold a grant for.
      expect(screen.getByRole("tab", { name: /Sources/ })).toBeInTheDocument();
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
      expect(await screen.findByTestId("tool-catalog-empty")).toBeInTheDocument();
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
      expect(await screen.findByTestId("tool-card-tool-claude-code")).toBeInTheDocument();
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
      // The source composer is reached from the Sources pane now. Adding a
      // TOOL registers a registry entry and opens a different drawer, so
      // pressing it here would sweep the wrong one.
      await openTab(/Sources/);
      await userEvent.click(screen.getAllByRole("button", { name: /Add source/ })[0]!);
      await userEvent.click(await screen.findByRole("menuitem", { name: /Anthropic Admin API/ }));
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
      expect(screen.getByRole("combobox", { name: "Frequency" })).toBeInTheDocument();
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });
});

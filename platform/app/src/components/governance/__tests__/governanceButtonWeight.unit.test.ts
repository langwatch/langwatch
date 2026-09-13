import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  collectFiles,
  sitesIn,
  solidOrangeButtonSites,
} from "../../../test-utils/buttonWeightScan";
// Read directly, not through the scanner, and that is the point: the
// self-check below has to prove the colour reader still finds `colorPalette`
// at all. Asking the scanner would ask the thing under test.
import { markColourSites } from "../../../test-utils/markColourScan";
import { parseSourceTexts } from "../../../test-utils/tsAst";

/**
 * No governance BUTTON is filled with the brand orange.
 *
 * The rule is "Primary page actions sit top-right in the page header" in
 * `specs/ai-governance/dashboard/governance-ui-controls.feature`. The product
 * owner rejected solid orange across the section; the create action is now the
 * house header button — `PageLayout.HeaderButton`, an outline button at the
 * small size — and everything beside it is ghost.
 *
 * **Why a scan and not only rendered tests.** The page tests each pin the page
 * they render. The controls that were solid when the ruling landed sat on four
 * pages, two drawers and two settings editors, so the way this regresses is a
 * ninth control appearing somewhere nobody thought to extend a test. A scan is
 * indifferent to which file the next one lands in.
 *
 * **What is reused and what is not.** The colour reading is `markColourSites`,
 * which already resolves a `colorPalette` written inline, held in a same-file
 * constant, split across a ternary or wrapped onto another line — four forms
 * that each defeated an earlier regex elsewhere in this repo. What it cannot
 * do is say WHICH element the attribute sat on, because it reports a colour
 * and a line and nothing about the tag. That is what this rule turns on, since
 * the same attribute on a badge is allowed and on a filled button is not. So
 * the new reading here is the tag, its span, and the `variant` beside it.
 *
 * **Two things are orange on purpose, and the scan has to see the difference.**
 *
 *   - The sample-data toggle (`SampleDataControls.tsx`) is
 *     `variant={active ? "subtle" : "ghost"}` and turns orange only while
 *     pressed. The ruling left that clause standing untouched.
 *   - The analytics range chips are the same shape — subtle orange for the
 *     selected one, outline grey for the rest. A selected chip is a state.
 *
 * Neither is FILLED, which is the word the rule is actually about. So a
 * violation is an orange button that is solid: `variant="solid"`, or no
 * variant at all, since Chakra fills a button by default. A variant this scan
 * cannot read statically counts as solid rather than as excused — an
 * unreadable quiet variant is a loud false positive, while an unreadable loud
 * one would be a silent hole.
 *
 * **The badge is not a violation and never was.** `AgentCard.tsx` draws an
 * "Unclaimed" agent with `variant="subtle" colorPalette="orange"`. A badge
 * states a fact about a thing; it is not something to press.
 */

const PACKAGE_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

/**
 * The governance surface the rule reaches: the section's own components and
 * its pages.
 *
 * `src/components/settings/governance` is deliberately NOT here, and the
 * sibling colour scan does include it, so the difference is worth stating. The
 * ruling covers page-header create actions and empty-state actions. The three
 * filled orange buttons in those settings editors are neither — they are
 * "Import starter pack" and two template actions inside an editor panel, and
 * judging them here would have been this scan enforcing a rule wider than the
 * one that was written.
 */
const ROOTS = ["src/components/governance", "src/pages/governance"].map(
  (relative) => join(PACKAGE_ROOT, relative),
);

/**
 * Counted in FILES, and measured against the live tree rather than guessed: 67
 * across the two roots, 55 + 12. A floor under the true count is the point, and
 * this one is tight enough to bite — losing either root on its own drops the
 * count below it, which is how a scan that has stopped reading gets caught
 * instead of quietly passing.
 */
const SCANNED_FILE_FLOOR = 60;

describe("governance button weight", () => {
  describe("given a source text the rule is pinned against", () => {
    it("catches a button asking for the brand palette with no variant, which fills it", () => {
      expect(
        sitesIn({
          fileName: "plain.tsx",
          sourceText: `export const C = () => <Button size="sm" colorPalette="orange">Add tool</Button>;`,
        }),
      ).toContainEqual(expect.objectContaining({ tag: "Button", line: 1 }));
    });

    it("catches the fill named out loud", () => {
      expect(
        sitesIn({
          fileName: "explicit.tsx",
          sourceText: `export const C = () => <Button variant="solid" colorPalette="orange" />;`,
        }),
      ).toHaveLength(1);
    });

    it("catches a palette held in a constant rather than written inline", () => {
      expect(
        sitesIn({
          fileName: "constant.tsx",
          sourceText: `const ACCENT = "orange";
           export const C = () => <Button colorPalette={ACCENT}>Add tool</Button>;`,
        }),
      ).toHaveLength(1);
    });

    it("catches the offending branch of a palette ternary, not only the first one read", () => {
      expect(
        sitesIn({
          fileName: "ternary.tsx",
          sourceText: `export const C = ({ on }) => <Button colorPalette={on ? "gray" : "orange"} />;`,
        }),
      ).toHaveLength(1);
    });

    it("catches an attribute wrapped onto a line below its tag", () => {
      expect(
        sitesIn({
          fileName: "multiline.tsx",
          sourceText: `export const C = () => (
             <Button
               size="sm"
               colorPalette="orange"
             >
               Add tool
             </Button>
           );`,
        }),
      ).toHaveLength(1);
    });

    it.each([
      "IconButton",
      "PageLayout.HeaderButton",
      "MenuButton",
      // Pressable, and in a scanned file: the hero's own lead pill and ask
      // chip are create actions wearing a different noun.
      "HeroLeadPill",
      "AskChip",
    ])("reads %s as a button, so a wrapper is not a way around the rule", (tag) => {
      expect(
        sitesIn({
          fileName: "wrapper.tsx",
          sourceText: `export const C = () => <${tag} colorPalette="orange" />;`,
        }),
      ).toHaveLength(1);
    });

    it("treats a variant it cannot read as filled, rather than as excused", () => {
      // The safe direction: an unreadable quiet variant is a false positive
      // somebody sees, an unreadable loud one would be a hole nobody does.
      expect(
        sitesIn({
          fileName: "opaque.tsx",
          sourceText: `export const C = ({ v }) => <Button variant={v} colorPalette="orange" />;`,
        }),
      ).toHaveLength(1);
    });

    it.each([
      [
        "the sample-data toggle at rest and pressed",
        `active ? "subtle" : "ghost"`,
      ],
      ["an analytics range chip", `active ? "subtle" : "outline"`],
    ])("leaves %s alone, because neither state is filled", (_label, variant) => {
      expect(
        sitesIn({
          fileName: "toggle.tsx",
          sourceText: `export const C = ({ active }) => (
             <Button
               variant={${variant}}
               colorPalette={active ? "orange" : undefined}
             />
           );`,
        }),
      ).toEqual([]);
    });

    it.each([
      "ghost",
      "subtle",
      "outline",
      "plain",
    ])("leaves a %s orange button alone", (variant) => {
      expect(
        sitesIn({
          fileName: "quiet.tsx",
          sourceText: `export const C = () => <Button variant="${variant}" colorPalette="orange" />;`,
        }),
      ).toEqual([]);
    });

    it("leaves a drawer footer submit alone, which the ruling settled", () => {
      expect(
        sitesIn({
          fileName: "drawer.tsx",
          sourceText: `export const C = () => (
             <Drawer.Root>
               <Drawer.Content>
                 <Drawer.Body>Body</Drawer.Body>
                 <Drawer.Footer>
                   <HStack>
                     <Button variant="ghost">Cancel</Button>
                     <Button colorPalette="orange">Save changes</Button>
                   </HStack>
                 </Drawer.Footer>
               </Drawer.Content>
             </Drawer.Root>
           );`,
        }),
      ).toEqual([]);
    });

    it("exempts a dialog footer on the same terms as a drawer footer", () => {
      // The exemption is written against the footer, not against the drawer,
      // because a dialog's footer submit is the same button making the same
      // promise. Both spellings are in the tree.
      expect(
        sitesIn({
          fileName: "dialog.tsx",
          sourceText: `export const C = () => (
             <Dialog.Root>
               <Dialog.Footer>
                 <Button colorPalette="orange">Confirm</Button>
               </Dialog.Footer>
             </Dialog.Root>
           );`,
        }),
      ).toEqual([]);
    });

    it("still catches a filled button in the same file as a drawer footer", () => {
      // The half of the footer rule that matters: skipping the footer must not
      // skip the page around it, which a line-distance reading would have done.
      expect(
        sitesIn({
          fileName: "page-and-drawer.tsx",
          sourceText: `export const C = () => (
             <Box>
               <Button colorPalette="orange">Add tool</Button>
               <Drawer.Root>
                 <Drawer.Footer>
                   <Button colorPalette="orange">Save</Button>
                 </Drawer.Footer>
               </Drawer.Root>
             </Box>
           );`,
        }),
      ).toHaveLength(1);
    });

    it("leaves an orange badge alone, because a badge states a fact", () => {
      expect(
        sitesIn({
          fileName: "badge.tsx",
          sourceText: `export const C = () => <Badge variant="subtle" colorPalette="orange">Unclaimed</Badge>;`,
        }),
      ).toEqual([]);
    });

    it("leaves an orange badge inside a filled button's label alone", () => {
      // The opening tag's span ends before the children, so the badge is judged
      // on its own tag rather than on the one it happens to sit inside.
      expect(
        sitesIn({
          fileName: "nested.tsx",
          sourceText: `export const C = () => (
             <Button colorPalette="gray">
               Register agent
               <Badge colorPalette="orange">New</Badge>
             </Button>
           );`,
        }),
      ).toEqual([]);
    });

    it("leaves a filled button in any other palette alone", () => {
      expect(
        sitesIn({
          fileName: "other.tsx",
          sourceText: `export const C = () => <Button colorPalette="gray">Cancel</Button>;`,
        }),
      ).toEqual([]);
    });
  });

  describe("given the governance screens on disk", () => {
    const files = ROOTS.flatMap(collectFiles);
    const parsed = parseSourceTexts({
      sources: files.map((path) => ({
        fileName: path,
        sourceText: readFileSync(path, "utf8"),
      })),
    });

    it("reads the whole governance surface, not a directory that moved", () => {
      // Three claims, and the last is the one that matters: a glob that matched
      // nothing, a root that was renamed, or a colour reader that stopped
      // reading `colorPalette` would each leave the rule below green forever.
      expect(files.length).toBeGreaterThan(SCANNED_FILE_FLOOR);
      expect(
        files.some((path) => path.endsWith("src/pages/governance/agents.tsx")),
      ).toBe(true);
      expect(
        parsed.flatMap(({ source }) =>
          markColourSites(source).filter(
            (site) => site.kind === "literal" && site.role === "colorPalette",
          ),
        ).length,
      ).toBeGreaterThan(0);
    });

    /** @scenario "Primary page actions sit top-right in the page header" */
    it("fills no button with the brand orange", () => {
      expect(
        parsed.flatMap(({ fileName, source }) =>
          solidOrangeButtonSites(source).map(
            (site) =>
              `${fileName.replace(PACKAGE_ROOT, "")}:${site.line} <${site.tag}>`,
          ),
        ),
      ).toEqual([]);
    });
  });
});

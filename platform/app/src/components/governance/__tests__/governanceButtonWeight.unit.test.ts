import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Expression, Node, SourceFile } from "typescript/unstable/ast";
import {
  isConditionalExpression,
  isJsxAttribute,
  isJsxExpression,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isStringLiteral,
} from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";

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

/** The brand accent, in the spellings a `colorPalette` is written in. */
const BRAND_ORANGE =
  /^(?:orange|var\(--chakra-colors-orange-solid\)|#ed8926)$/i;

/** Every Chakra button variant that does not fill the button. */
const UNFILLED = new Set(["ghost", "subtle", "outline", "plain", "surface"]);

/**
 * A tag whose last segment ends in `Button` — `Button`, `IconButton`,
 * `PageLayout.HeaderButton`. Matching the last segment rather than the whole
 * text is what makes a namespaced house button readable; matching the suffix
 * rather than an enumerated list is what makes the next wrapper readable
 * without editing this file.
 */
const BUTTON_TAG = /(?:^|\.)[A-Za-z0-9_]*Button$/;

/**
 * A tag whose last segment ends in `Footer` — `Drawer.Footer`,
 * `Dialog.Footer`, `ModalFooter`.
 *
 * A drawer footer's submit stays solid orange, which the rule says out loud
 * rather than leaving to be rediscovered: it is the app-wide convention
 * outside governance too, a drawer is the only thing on screen when it is
 * open, and the fill is how every drawer in this product says which of the two
 * buttons commits. Anything under one of these tags is out of this scan's
 * reach.
 */
const FOOTER_TAG = /(?:^|\.)[A-Za-z0-9_]*Footer$/;

/**
 * The string values one expression can produce, and whether all of them were
 * legible. A ternary yields BOTH branches, because a button that is filled down
 * one path is filled.
 *
 * Deliberately narrower than the resolver in `markColourScan`, which reaches
 * same-file constants but is private to that module and keyed to colour roles.
 * Every `variant` in this section is written inline or as a ternary of
 * literals; anything else lands in `resolved: false`, which this scan treats as
 * filled rather than as clean.
 */
function stringsOf(expression: Expression): {
  values: string[];
  resolved: boolean;
} {
  if (isStringLiteral(expression)) {
    return { values: [expression.text], resolved: true };
  }

  if (isConditionalExpression(expression)) {
    const whenTrue = stringsOf(expression.whenTrue);
    const whenFalse = stringsOf(expression.whenFalse);
    return {
      values: [...whenTrue.values, ...whenFalse.values],
      resolved: whenTrue.resolved && whenFalse.resolved,
    };
  }

  return { values: [], resolved: false };
}

/** The value of one named attribute on an opening tag, if it carries one. */
function attributeValue(
  element: Node,
  wanted: string,
  source: SourceFile,
): Expression | undefined {
  let found: Expression | undefined;

  element.forEachChild((child) => {
    child.forEachChild((attribute) => {
      if (!isJsxAttribute(attribute) || !attribute.name) return;

      const name = source
        .getText()
        .slice(attribute.name.getStart(source), attribute.name.getEnd());
      if (name !== wanted) return;

      const initializer = attribute.initializer;
      if (!initializer) return;

      if (isStringLiteral(initializer)) {
        found = initializer;
      } else if (isJsxExpression(initializer) && initializer.expression) {
        found = initializer.expression;
      }
    });
  });

  return found;
}

/** Whether this opening tag draws a button with a fill behind its label. */
function isFilled(element: Node, source: SourceFile): boolean {
  const variant = attributeValue(element, "variant", source);

  // No variant at all is the plainest way to get a filled button, and it is how
  // most of the section's solid orange was written.
  if (!variant) return true;

  const { values, resolved } = stringsOf(variant);
  if (!resolved) return true;

  return values.some((value) => !UNFILLED.has(value));
}

/**
 * The lines each FILLED button-like element's opening tag occupies, skipping
 * anything inside a drawer footer.
 *
 * The footer is skipped by carrying a flag down the walk rather than by
 * looking upwards from the button. The parsed nodes here have no usable parent
 * link, and a line-distance guess — "is there a Footer tag above this one" —
 * would excuse every button in a file that closes with a drawer.
 */
function filledButtonSpans(
  source: SourceFile,
): Array<{ tag: string; from: number; to: number }> {
  const spans: Array<{ tag: string; from: number; to: number }> = [];
  const text = source.getText();

  const tagOf = (node: { tagName: Node }): string =>
    text.slice(node.tagName.getStart(source), node.tagName.getEnd()).trim();

  const visit = (node: Node, inFooter: boolean): void => {
    let footerHere = inFooter;

    if (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) {
      const tag = tagOf(node);

      if (FOOTER_TAG.test(tag)) {
        footerHere = true;
      }

      if (!inFooter && BUTTON_TAG.test(tag) && isFilled(node, source)) {
        spans.push({
          tag,
          from:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          to: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
        });
      }
    }

    // A `<Drawer.Footer>` opening tag is a SIBLING of the children it wraps,
    // not their ancestor, so the flag is raised on the enclosing element by
    // checking its opening tag before its children are walked.
    if (!footerHere) {
      const opening = node.forEachChild((child) =>
        (isJsxOpeningElement(child) || isJsxSelfClosingElement(child)) &&
        FOOTER_TAG.test(tagOf(child))
          ? child
          : undefined,
      );
      if (opening) footerHere = true;
    }

    node.forEachChild((child) => {
      visit(child, footerHere);
    });
  };

  visit(source, false);
  return spans;
}

/**
 * Every place this file fills a button with the brand accent.
 *
 * A colour site counts against a button when it falls inside that button's
 * OPENING tag. An opening tag's span stops before the element's children, so a
 * badge nested in a button's label is judged on its own and not on its host.
 */
function solidOrangeButtonSites(
  source: SourceFile,
): Array<{ tag: string; line: number }> {
  const spans = filledButtonSpans(source);

  return markColourSites(source).flatMap((site) => {
    if (site.kind !== "literal") return [];
    if (site.role !== "colorPalette") return [];
    if (!BRAND_ORANGE.test(site.value)) return [];

    const owner = spans.find(
      (span) => site.line >= span.from && site.line <= span.to,
    );

    return owner ? [{ tag: owner.tag, line: site.line }] : [];
  });
}

function collectFiles(directory: string): string[] {
  const found: string[] = [];
  let entries: string[];

  try {
    entries = readdirSync(directory);
  } catch {
    return found;
  }

  for (const entry of entries) {
    const path = join(directory, entry);

    try {
      if (statSync(path).isDirectory()) {
        found.push(...collectFiles(path));
        continue;
      }
    } catch {
      // A file another agent deleted between the listing and the stat. Skip it
      // rather than fail the suite on a race nobody can reproduce.
      continue;
    }

    if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }

  return found;
}

function sitesIn(fileName: string, sourceText: string) {
  const [parsed] = parseSourceTexts({ sources: [{ fileName, sourceText }] });
  return parsed ? solidOrangeButtonSites(parsed.source) : [];
}

describe("governance button weight", () => {
  describe("the rule itself, pinned before it is pointed at the tree", () => {
    it("catches a button asking for the brand palette with no variant, which fills it", () => {
      expect(
        sitesIn(
          "plain.tsx",
          `export const C = () => <Button size="sm" colorPalette="orange">Add tool</Button>;`,
        ),
      ).toContainEqual(expect.objectContaining({ tag: "Button", line: 1 }));
    });

    it("catches the fill named out loud", () => {
      expect(
        sitesIn(
          "explicit.tsx",
          `export const C = () => <Button variant="solid" colorPalette="orange" />;`,
        ),
      ).toHaveLength(1);
    });

    it("catches a palette held in a constant rather than written inline", () => {
      expect(
        sitesIn(
          "constant.tsx",
          `const ACCENT = "orange";
           export const C = () => <Button colorPalette={ACCENT}>Add tool</Button>;`,
        ),
      ).toHaveLength(1);
    });

    it("catches the offending branch of a palette ternary, not only the first one read", () => {
      expect(
        sitesIn(
          "ternary.tsx",
          `export const C = ({ on }) => <Button colorPalette={on ? "gray" : "orange"} />;`,
        ),
      ).toHaveLength(1);
    });

    it("catches an attribute wrapped onto a line below its tag", () => {
      expect(
        sitesIn(
          "multiline.tsx",
          `export const C = () => (
             <Button
               size="sm"
               colorPalette="orange"
             >
               Add tool
             </Button>
           );`,
        ),
      ).toHaveLength(1);
    });

    it.each([
      "IconButton",
      "PageLayout.HeaderButton",
      "MenuButton",
    ])("reads %s as a button, so a wrapper is not a way around the rule", (tag) => {
      expect(
        sitesIn(
          "wrapper.tsx",
          `export const C = () => <${tag} colorPalette="orange" />;`,
        ),
      ).toHaveLength(1);
    });

    it("treats a variant it cannot read as filled, rather than as excused", () => {
      // The safe direction: an unreadable quiet variant is a false positive
      // somebody sees, an unreadable loud one would be a hole nobody does.
      expect(
        sitesIn(
          "opaque.tsx",
          `export const C = ({ v }) => <Button variant={v} colorPalette="orange" />;`,
        ),
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
        sitesIn(
          "toggle.tsx",
          `export const C = ({ active }) => (
             <Button
               variant={${variant}}
               colorPalette={active ? "orange" : undefined}
             />
           );`,
        ),
      ).toEqual([]);
    });

    it.each([
      "ghost",
      "subtle",
      "outline",
      "plain",
    ])("leaves a %s orange button alone", (variant) => {
      expect(
        sitesIn(
          "quiet.tsx",
          `export const C = () => <Button variant="${variant}" colorPalette="orange" />;`,
        ),
      ).toEqual([]);
    });

    it("leaves a drawer footer submit alone, which the ruling settled", () => {
      expect(
        sitesIn(
          "drawer.tsx",
          `export const C = () => (
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
        ),
      ).toEqual([]);
    });

    it("exempts a dialog footer on the same terms as a drawer footer", () => {
      // The exemption is written against the footer, not against the drawer,
      // because a dialog's footer submit is the same button making the same
      // promise. Both spellings are in the tree.
      expect(
        sitesIn(
          "dialog.tsx",
          `export const C = () => (
             <Dialog.Root>
               <Dialog.Footer>
                 <Button colorPalette="orange">Confirm</Button>
               </Dialog.Footer>
             </Dialog.Root>
           );`,
        ),
      ).toEqual([]);
    });

    it("still catches a filled button in the same file as a drawer footer", () => {
      // The half of the footer rule that matters: skipping the footer must not
      // skip the page around it, which a line-distance reading would have done.
      expect(
        sitesIn(
          "page-and-drawer.tsx",
          `export const C = () => (
             <Box>
               <Button colorPalette="orange">Add tool</Button>
               <Drawer.Root>
                 <Drawer.Footer>
                   <Button colorPalette="orange">Save</Button>
                 </Drawer.Footer>
               </Drawer.Root>
             </Box>
           );`,
        ),
      ).toHaveLength(1);
    });

    it("leaves an orange badge alone, because a badge states a fact", () => {
      expect(
        sitesIn(
          "badge.tsx",
          `export const C = () => <Badge variant="subtle" colorPalette="orange">Unclaimed</Badge>;`,
        ),
      ).toEqual([]);
    });

    it("leaves an orange badge inside a filled button's label alone", () => {
      // The opening tag's span ends before the children, so the badge is judged
      // on its own tag rather than on the one it happens to sit inside.
      expect(
        sitesIn(
          "nested.tsx",
          `export const C = () => (
             <Button colorPalette="gray">
               Register agent
               <Badge colorPalette="orange">New</Badge>
             </Button>
           );`,
        ),
      ).toEqual([]);
    });

    it("leaves a filled button in any other palette alone", () => {
      expect(
        sitesIn(
          "other.tsx",
          `export const C = () => <Button colorPalette="gray">Cancel</Button>;`,
        ),
      ).toEqual([]);
    });
  });

  describe("the governance screens themselves", () => {
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

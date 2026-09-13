import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Expression, Node, SourceFile } from "typescript/unstable/ast";
import {
  isConditionalExpression,
  isJsxAttribute,
  isJsxExpression,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isStringLiteral,
} from "typescript/unstable/ast";

import { markColourSites } from "./markColourScan";
import { parseSourceTexts } from "./tsAst";

/**
 * Finding pressable controls that are FILLED with the brand accent.
 *
 * Lives here rather than in the suite that first needed it, next to the
 * `markColourSites` and `parseSourceTexts` it is built on. The suite that
 * points it at the governance tree is one caller; the rule it implements —
 * "a filled brand-orange control is a page action, and page actions are
 * outline" — is not specific to that tree, and the next section to adopt the
 * ruling should not have to copy 200 lines to enforce it.
 *
 * WHAT IT CANNOT SEE, stated so nobody trusts it further than it reaches: the
 * fill has to arrive through a `colorPalette` attribute `markColourSites` can
 * read. A house control that fills itself from a boolean of its own — the
 * `prominent` prop on `HeroLeadPill` is the one in the tree today — is
 * invisible to this scan however loud it renders. Widening it means teaching
 * `markColourScan` about that prop, not adding a tag here.
 */

/** The brand accent, in the spellings a `colorPalette` is written in. */
export const BRAND_ORANGE =
  /^(?:orange|var\(--chakra-colors-orange-solid\)|#ed8926)$/i;

/** Every Chakra button variant that does not fill the button. */
const UNFILLED = new Set(["ghost", "subtle", "outline", "plain", "surface"]);

/**
 * A tag whose last segment names something a reader presses — `Button`,
 * `IconButton`, `PageLayout.HeaderButton`, and the pill and chip spellings the
 * home surfaces use for the same job.
 *
 * Matching the last segment rather than the whole text is what makes a
 * namespaced house button readable; matching a suffix rather than an
 * enumerated list is what makes the next wrapper readable without editing this
 * file. `Pill` and `Chip` are here because `HeroLeadPill` and `AskChip` are
 * pressable controls sitting in a scanned file — a scan indifferent to which
 * file the next control lands in should not be picky about what it is called.
 */
const BUTTON_TAG = /(?:^|\.)[A-Za-z0-9_]*(?:Button|Pill|Chip)$/;

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

/** One filled control the scan found, and the line its colour sits on. */
export interface ButtonWeightSite {
  tag: string;
  line: number;
}

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

/**
 * The expression one attribute node is set to, when that attribute is the one
 * being asked for. Undefined for every other node the walk meets.
 */
function initializerOf({
  attribute,
  wanted,
  source,
}: {
  attribute: Node;
  wanted: string;
  source: SourceFile;
}): Expression | undefined {
  if (!isJsxAttribute(attribute) || !attribute.name) return undefined;

  const name = source
    .getText()
    .slice(attribute.name.getStart(source), attribute.name.getEnd());
  if (name !== wanted) return undefined;

  const initializer = attribute.initializer;
  if (!initializer) return undefined;

  if (isStringLiteral(initializer)) return initializer;
  if (isJsxExpression(initializer) && initializer.expression) {
    return initializer.expression;
  }
  return undefined;
}

/** The value of one named attribute on an opening tag, if it carries one. */
function attributeValue({
  element,
  wanted,
  source,
}: {
  element: Node;
  wanted: string;
  source: SourceFile;
}): Expression | undefined {
  let found: Expression | undefined;

  element.forEachChild((child) => {
    child.forEachChild((attribute) => {
      found = initializerOf({ attribute, wanted, source }) ?? found;
    });
  });

  return found;
}

/** Whether this opening tag draws a button with a fill behind its label. */
function isFilled({
  element,
  source,
}: {
  element: Node;
  source: SourceFile;
}): boolean {
  const variant = attributeValue({ element, wanted: "variant", source });

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

  const isTag = (node: Node): node is Node & { tagName: Node } =>
    isJsxOpeningElement(node) || isJsxSelfClosingElement(node);

  /**
   * A `<Drawer.Footer>` opening tag is a SIBLING of the children it wraps, not
   * their ancestor, so the flag is raised on the ENCLOSING element by checking
   * its opening tag before its children are walked.
   */
  const wrapsFooter = (node: Node): boolean =>
    node.forEachChild((child) =>
      isTag(child) && FOOTER_TAG.test(tagOf(child)) ? true : undefined,
    ) ?? false;

  const record = (node: Node & { tagName: Node }, tag: string): void => {
    if (!BUTTON_TAG.test(tag)) return;
    if (!isFilled({ element: node, source })) return;

    spans.push({
      tag,
      from:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      to: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
    });
  };

  const visit = (node: Node, inFooter: boolean): void => {
    const tag = isTag(node) ? tagOf(node) : null;

    if (tag !== null && !inFooter)
      record(node as Node & { tagName: Node }, tag);

    const footerHere =
      inFooter || (tag !== null && FOOTER_TAG.test(tag)) || wrapsFooter(node);

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
export function solidOrangeButtonSites(source: SourceFile): ButtonWeightSite[] {
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

/** Every non-test `.ts`/`.tsx` file under a directory, recursively. */
export function collectFiles(directory: string): string[] {
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

/** The scan, run against a source text rather than a file on disk. */
export function sitesIn({
  fileName,
  sourceText,
}: {
  fileName: string;
  sourceText: string;
}): ButtonWeightSite[] {
  const [parsed] = parseSourceTexts({ sources: [{ fileName, sourceText }] });
  return parsed ? solidOrangeButtonSites(parsed.source) : [];
}

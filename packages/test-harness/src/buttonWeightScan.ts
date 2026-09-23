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

import { markColourSites } from "./markColourScan.ts";
import { parseSourceTexts } from "./ts-ast.ts";

/**
 * Finds filled brand controls via `colorPalette` attribute (not prop-based
 * fills like `prominent`). Reusable, colocated with markColourSites.
 */

/** The brand accent, in the spellings a `colorPalette` is written in. */
export const BRAND_ORANGE = /^(?:orange|var\(--chakra-colors-orange-solid\)|#ed8926)$/i;

/** Every Chakra button variant that does not fill the button. */
const UNFILLED = new Set(["ghost", "subtle", "outline", "plain", "surface"]);

/**
 * Button tag pattern: match by suffix (`Button`, `Pill`, `Chip`) for
 * namespaced components and future wrappers.
 */
const BUTTON_TAG = /(?:^|\.)[A-Za-z0-9_]*(?:Button|Pill|Chip)$/;

/**
 * Footer tag pattern: drawer footer buttons stay solid orange by app
 * convention (out of scope).
 */
const FOOTER_TAG = /(?:^|\.)[A-Za-z0-9_]*Footer$/;

/** One filled control the scan found, and the line its colour sits on. */
export interface ButtonWeightSite {
  tag: string;
  line: number;
}

/**
 * String values from expression: ternary yields both branches. Unresolved
 * treated as filled.
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

  const name = source.getText().slice(attribute.name.getStart(source), attribute.name.getEnd());
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
function isFilled({ element, source }: { element: Node; source: SourceFile }): boolean {
  const variant = attributeValue({ element, wanted: "variant", source });

  // No variant at all is the plainest way to get a filled button, and it is how
  // most of the section's solid orange was written.
  if (!variant) return true;

  const { values, resolved } = stringsOf(variant);
  if (!resolved) return true;

  return values.some((value) => !UNFILLED.has(value));
}

type TagText = { source: SourceFile; text: string };

function tagOf({ node, source, text }: TagText & { node: { tagName: Node } }): string {
  return text.slice(node.tagName.getStart(source), node.tagName.getEnd()).trim();
}

function isTag(node: Node): node is Node & { tagName: Node } {
  return isJsxOpeningElement(node) || isJsxSelfClosingElement(node);
}

/**
 * A `<Drawer.Footer>` opening tag is a SIBLING of the children it wraps, not
 * their ancestor, so the flag is raised on the ENCLOSING element by checking
 * its opening tag before its children are walked.
 */
function wrapsFooter({ node, source, text }: TagText & { node: Node }): boolean {
  return (
    node.forEachChild((child) => {
      if (!isTag(child)) return undefined;
      return FOOTER_TAG.test(tagOf({ node: child, source, text })) ? true : undefined;
    }) ?? false
  );
}

/**
 * Filled button spans on lines: skips drawer footer via flag (nodes lack
 * parent links).
 */
function filledButtonSpans(source: SourceFile): { tag: string; from: number; to: number }[] {
  const spans: { tag: string; from: number; to: number }[] = [];
  const text = source.getText();

  const record = (node: Node & { tagName: Node }, tag: string): void => {
    if (!BUTTON_TAG.test(tag)) return;
    if (!isFilled({ element: node, source })) return;

    spans.push({
      tag,
      from: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      to: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
    });
  };

  const visit = (node: Node, inFooter: boolean): void => {
    const tag = isTag(node) ? tagOf({ node, source, text }) : null;

    if (tag !== null && !inFooter) record(node as Node & { tagName: Node }, tag);

    const footerHere =
      inFooter || (tag !== null && FOOTER_TAG.test(tag)) || wrapsFooter({ node, source, text });

    node.forEachChild((child) => {
      visit(child, footerHere);
    });
  };

  visit(source, false);
  return spans;
}

/**
 * Every place this file fills a button with the brand accent. A colour
 * site counts against a button when it falls inside that button's OPENING
 * tag, which stops before its children — a nested badge is judged on its own, not its host.
 */
export function solidOrangeButtonSites(source: SourceFile): ButtonWeightSite[] {
  const spans = filledButtonSpans(source);

  return markColourSites(source).flatMap((site) => {
    if (site.kind !== "literal") return [];
    if (site.role !== "colorPalette") return [];
    if (!BRAND_ORANGE.test(site.value)) return [];

    const owner = spans.find((span) => site.line >= span.from && site.line <= span.to);

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

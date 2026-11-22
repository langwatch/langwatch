/**
 * Literal pixel paddings, margins and gaps to the spacing scale (Chakra's, 4px a step).
 * Converts a design-system element's prop and the style objects passed to it; every
 * other site the census counts is listed with its reason, never rounded or guessed.
 */
import {
  type AstNode,
  type Change,
  type FileOutcome,
  type Parsed,
  type Transform,
  child,
  childNodes,
  isDesignSystemSource,
  parse,
  resolveElement,
  text,
} from "../ast.ts";

/** The spacing tokens of `@chakra-ui/react`'s default config, which ours does not override. */
const SCALE = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40,
  44, 48, 52, 56, 60, 64, 72, 80, 96,
];
const SPACING_ALIASES = new Set(
  ["p", "px", "py", "pt", "pb", "pl", "pr", "ps", "pe"].concat([
    "m",
    "mx",
    "my",
    "mt",
    "mb",
    "ml",
    "mr",
    "ms",
    "me",
  ]),
);
const SPACING = /^(padding|margin|gap$|rowGap$|columnGap$)/;
const PIXELS = /\d(px)\b/;
const ONE_PIXEL_VALUE = /^(-?)(\d+(?:\.\d+)?)px$/;
/** Nodes a style value may pass through and still be the literal the element receives. */
const TRANSPARENT = new Set([
  "JSXExpressionContainer",
  "ObjectExpression",
  "Property",
  "ArrayExpression",
  "ConditionalExpression",
  "LogicalExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
]);

const isSpacing = (prop: string) => SPACING_ALIASES.has(prop) || SPACING.test(prop);

/** `16px` reads token `4`; undefined when the value does not land on the scale. */
export function tokenFor({ value, prop }: { value: string; prop: string }): string | undefined {
  const match = ONE_PIXEL_VALUE.exec(value);
  if (!match) return undefined;
  const negative = match[1] === "-";
  if (negative && !/^(m|margin)/.test(prop)) return undefined;
  const step = Number(match[2]) / 4;
  if (!SCALE.includes(step)) return undefined;
  if (step === 0) return "0";
  return `${negative ? "-" : ""}${step}`;
}

type Owner = { ds: boolean; ref: string; style: boolean; direct: boolean };
type Walk = { parsed: Parsed; outcome: FileOutcome; owner?: Owner };

function skip({ walk, node, reason }: { walk: Walk; node: AstNode; reason: string }) {
  const { parsed } = walk;
  const line = parsed.lineOf({ offset: node.start });
  walk.outcome.skips.push({ line, snippet: parsed.snippetOf({ node }), reason });
}

/** Why a site found where `owner` puts it cannot convert; undefined when it can. */
function blocker({ owner, prop, value }: { owner?: Owner; prop: string; value: string }) {
  if (!owner) return "style object not written inline on a JSX element";
  if (owner.style) return "React `style` takes raw CSS, not tokens";
  if (!owner.ds) return `\`${owner.ref}\` is not a design-system element`;
  if (!owner.direct) return "inside a computed expression";
  if (!ONE_PIXEL_VALUE.test(value)) return "not a single pixel value";
  if (!tokenFor({ value, prop })) return "off the spacing scale (never rounded)";
  return undefined;
}

/** One spacing prop or property with a literal value: convert it, or say why not. */
function visitLiteral({
  walk,
  site,
  prop,
  literal,
  replace,
}: {
  walk: Walk;
  site: AstNode;
  prop: string;
  literal: AstNode;
  replace: AstNode;
}) {
  const value = literal.value;
  const styleNumber = typeof value === "number" && value !== 0 && walk.owner?.style === true;
  const pixels = typeof value === "string" && PIXELS.test(value);
  if (!isSpacing(prop) || !(pixels || styleNumber)) return;
  const written = String(value);
  const reason = blocker({ owner: walk.owner, prop, value: styleNumber ? "" : written });
  if (reason || styleNumber) {
    return skip({ walk, node: site, reason: reason ?? "React `style` number" });
  }
  const token = tokenFor({ value: written, prop }) ?? written;
  const { parsed, outcome } = walk;
  const before = parsed.source.slice(site.start, site.end);
  const quoted = `"${token}"`;
  const after =
    before.slice(0, replace.start - site.start) + quoted + before.slice(replace.end - site.start);
  outcome.edits.push({ start: replace.start, end: replace.end, text: quoted });
  const where = `${walk.owner?.ref ?? ""} `;
  const line = parsed.lineOf({ offset: site.start });
  const change: Change = { line, before: where + before, after: where + after };
  outcome.changes.push(change);
}

function visitAttribute({ walk, node }: { walk: Walk; node: AstNode }) {
  const name = text(child(node, "name"), "name") ?? "";
  const value = child(node, "value");
  const inner = value?.type === "JSXExpressionContainer" ? child(value, "expression") : value;
  if (inner?.type === "Literal") {
    visitLiteral({ walk, site: node, prop: name, literal: inner, replace: value ?? inner });
  }
  const owner = walk.owner ? { ...walk.owner, style: name === "style" } : undefined;
  for (const next of childNodes({ node })) visit({ walk: { ...walk, owner }, node: next });
}

function visitProperty({ walk, node }: { walk: Walk; node: AstNode }) {
  const key = child(node, "key");
  const name = text(key, "name") ?? text(key, "value");
  const value = child(node, "value");
  const computed = node.computed === true;
  if (name && !computed && value?.type === "Literal") {
    visitLiteral({ walk, site: node, prop: name, literal: value, replace: value });
  }
  for (const next of childNodes({ node })) visit({ walk, node: next });
}

function visitElement({ walk, node }: { walk: Walk; node: AstNode }) {
  const opening = child(node, "openingElement");
  const resolved = opening ? resolveElement({ parsed: walk.parsed, opening }) : undefined;
  const source = resolved?.binding?.source;
  const owner: Owner = {
    ds: source !== undefined && isDesignSystemSource(source),
    ref: resolved?.ref ?? "element",
    style: false,
    direct: true,
  };
  for (const attribute of childNodes({ node: opening ?? node })) {
    if (attribute.type === "JSXAttribute")
      visitAttribute({ walk: { ...walk, owner }, node: attribute });
    else visit({ walk: { ...walk, owner }, node: attribute });
  }
  for (const next of bodyOf({ node })) visit({ walk: { ...walk, owner: undefined }, node: next });
}

const bodyOf = ({ node }: { node: AstNode }) =>
  childNodes({ node }).filter((next) => next.type !== "JSXOpeningElement");

function visit({ walk, node }: { walk: Walk; node: AstNode }) {
  if (node.type === "JSXElement") return visitElement({ walk, node });
  if (node.type === "JSXAttribute") return visitAttribute({ walk, node });
  if (node.type === "Property") return visitProperty({ walk, node });
  const owner =
    walk.owner && !TRANSPARENT.has(node.type) ? { ...walk.owner, direct: false } : walk.owner;
  for (const next of childNodes({ node })) visit({ walk: { ...walk, owner }, node: next });
}

export function pixelSpacing({ file, source }: { file: string; source: string }): FileOutcome {
  const parsed = parse({ file, source });
  const outcome: FileOutcome = { edits: [], changes: [], skips: [] };
  visit({ walk: { parsed, outcome }, node: parsed.program });
  return outcome;
}

export const pixelSpacingTransform: Transform = {
  name: "pixel-spacing",
  summary: "Literal pixel paddings, margins and gaps on design-system elements to spacing tokens",
  run: pixelSpacing,
};

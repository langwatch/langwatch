/**
 * A literal `maxWidth` on Dialog.Content becomes the Root `size` of the nearest width
 * within 4rem. Body padding is left to simple-drawer, which reads it as `body="flush"`
 * where it converts; the Drawer ground has its own transform (drawer-ground).
 */
import {
  type AstNode,
  type Edit,
  type FileOutcome,
  type Parsed,
  type Transform,
  child,
  jsxElements,
  parse,
} from "../ast.ts";
import {
  type Attr,
  FAMILY_SOURCE,
  attrsOf,
  literalOf,
  meaningful,
  ownedElsewhere,
  partOf,
  attrEdit,
  safeAttr,
} from "../overlay-parts.ts";
import { pixelsOf } from "../overlay-read.ts";

const SIZES: [string, number][] = [
  ["sm", 448],
  ["md", 512],
  ["lg", 672],
  ["xl", 896],
];
const ROOT_SIZES = ["xs", "sm", "md", "lg", "xl"];
const MAX_JUMP_PX = 64;
const WIDTH_PROPS = ["width", "w", "minWidth", "minW", "maxWidth", "maxW"];

function nearestSize({ px }: { px: number }): string | undefined {
  const ranked = SIZES.toSorted((a, b) => Math.abs(a[1] - px) - Math.abs(b[1] - px));
  const [name, width] = ranked[0] ?? [];
  return name && width !== undefined && Math.abs(width - px) <= MAX_JUMP_PX ? name : undefined;
}

/** Why a maxWidth cannot become a Root size, or undefined when it can. */
function widthReason({
  px,
  chosen,
  attrs,
  width,
  rootSize,
}: {
  px: number | undefined;
  chosen: string | undefined;
  attrs: Attr[];
  width: Attr;
  rootSize: Attr | undefined;
}): string | undefined {
  if (px === undefined) return "maxWidth is not a literal px or rem";
  if (!chosen) return `${px}px is more than 4rem from any size`;
  if (attrs.some((attr) => attr.node !== width.node && WIDTH_PROPS.includes(attr.name))) {
    return "Content has another width prop";
  }
  const sized = rootSize ? literalOf({ node: rootSize.value }) : undefined;
  if (rootSize && (typeof sized !== "string" || !ROOT_SIZES.includes(sized))) {
    return "Root size is not a plain size";
  }
  return undefined;
}

function sizeEdit({
  rootOpening,
  rootSize,
  chosen,
}: {
  rootOpening: AstNode;
  rootSize: Attr | undefined;
  chosen: string;
}): Edit | undefined {
  if (rootSize)
    return { start: rootSize.node.start, end: rootSize.node.end, text: `size="${chosen}"` };
  const name = child(rootOpening, "name");
  return name ? { start: name.end, end: name.end, text: ` size="${chosen}"` } : undefined;
}

function dialogWidth({
  parsed,
  root,
  outcome,
}: {
  parsed: Parsed;
  root: AstNode;
  outcome: FileOutcome;
}) {
  const [content] = meaningful({ element: root });
  if (!content || partOf({ parsed, element: content, family: "Dialog" }) !== "Content") return;
  const contentOpening = child(content, "openingElement");
  const rootOpening = child(root, "openingElement");
  const width =
    safeAttr({ parsed, outcome, opening: contentOpening, name: "maxWidth" }) ??
    safeAttr({ parsed, outcome, opening: contentOpening, name: "maxW" });
  if (!width || !rootOpening) return;
  const line = parsed.lineOf({ offset: width.node.start });
  const snippet = parsed.snippetOf({ node: width.node });
  const rootSize = safeAttr({ parsed, outcome, opening: rootOpening, name: "size" });
  const px = pixelsOf({ node: width.value });
  const chosen = px === undefined ? undefined : nearestSize({ px });
  const attrs = attrsOf({ opening: contentOpening });
  const reason = widthReason({ px, chosen, attrs, width, rootSize });
  const size = chosen ? sizeEdit({ rootOpening, rootSize, chosen }) : undefined;
  if (reason || !size) {
    outcome.skips.push({ line, snippet, reason: reason ?? "Root has no name" });
    return;
  }
  outcome.edits.push(attrEdit({ parsed, attr: width }), size);
  outcome.changes.push({ line, before: snippet, after: size.text.trim() });
}

export function overlayCosmetics({ file, source }: { file: string; source: string }): FileOutcome {
  const outcome: FileOutcome = { edits: [], changes: [], skips: [] };
  if (ownedElsewhere({ file })) return outcome;
  const parsed = parse({ file, source });
  const imports = [...parsed.bindings.values()].map((binding) => binding.source);
  if (!imports.includes(FAMILY_SOURCE.Dialog)) return outcome;
  for (const root of jsxElements({ node: parsed.program })) {
    if (partOf({ parsed, element: root, family: "Dialog" }) === "Root") {
      dialogWidth({ parsed, root, outcome });
    }
  }
  return outcome;
}

export const overlayCosmeticsTransform: Transform = {
  name: "overlay-cosmetics",
  summary: "Dialog.Content literal maxWidth to the nearest Root size, within 4rem",
  run: overlayCosmetics,
};

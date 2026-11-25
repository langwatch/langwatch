/**
 * Drops `bg="bg"` from Drawer.Content so the recipe owns the ground. The recipe ground is
 * bg.overlay, a visible change on a drawer that stays part-built, so this runs on request
 * once ruling Q3 (light and dark screenshots) is made; simple-drawer drops it on its own.
 */
import { type FileOutcome, type Transform, child, jsxElements, parse } from "../ast.ts";
import {
  FAMILY_SOURCE,
  attrEdit,
  literalOf,
  ownedElsewhere,
  partOf,
  safeAttr,
} from "../overlay-parts.ts";

export function drawerGround({ file, source }: { file: string; source: string }): FileOutcome {
  const outcome: FileOutcome = { edits: [], changes: [], skips: [] };
  if (ownedElsewhere({ file })) return outcome;
  const parsed = parse({ file, source });
  if (![...parsed.bindings.values()].some((entry) => entry.source === FAMILY_SOURCE.Drawer)) {
    return outcome;
  }
  for (const element of jsxElements({ node: parsed.program })) {
    if (partOf({ parsed, element, family: "Drawer" }) !== "Content") continue;
    const opening = child(element, "openingElement");
    const bg = safeAttr({ parsed, outcome, opening, name: "bg" });
    if (!bg) continue;
    const line = parsed.lineOf({ offset: bg.node.start });
    const snippet = parsed.snippetOf({ node: bg.node });
    if (literalOf({ node: bg.value }) !== "bg") {
      outcome.skips.push({
        line,
        snippet,
        reason: "Drawer.Content ground is not the default `bg`",
      });
      continue;
    }
    outcome.edits.push(attrEdit({ parsed, attr: bg }));
    outcome.changes.push({ line, before: snippet, after: "(removed: the recipe owns the ground)" });
  }
  return outcome;
}

export const drawerGroundTransform: Transform = {
  name: "drawer-ground",
  summary: 'Drop Drawer.Content bg="bg" (held for ruling Q3: the recipe ground is bg.overlay)',
  run: drawerGround,
};

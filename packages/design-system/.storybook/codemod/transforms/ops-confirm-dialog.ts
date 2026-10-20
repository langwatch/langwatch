/**
 * The ops module's own ConfirmDialog to `@langwatch/design-system/confirm-dialog`, which
 * takes onClose, description and children as the ops one does; only isLoading renames.
 * confirmDisabled and spreads have no DS equivalent; a file converts only when all its sites do.
 */
import {
  type AstNode,
  type Binding,
  type Edit,
  type FileOutcome,
  type Parsed,
  type Transform,
  child,
  childNodes,
  children,
  parse,
  text,
} from "../ast.ts";

const DS_SOURCE = "@langwatch/design-system/confirm-dialog";
const OPS_SOURCE = /(^|\/)ops-confirm-dialog(\.tsx)?$/;
const RENAMES: Record<string, string> = {
  key: "key",
  open: "open",
  onConfirm: "onConfirm",
  title: "title",
  onClose: "onClose",
  description: "description",
  isLoading: "loading",
};

type Site = { element: AstNode; node: AstNode; edits: Edit[]; reason?: string };

function jsxElements({ node }: { node: AstNode }): AstNode[] {
  const own = node.type === "JSXElement" ? [node] : [];
  return own.concat(childNodes({ node }).flatMap((next) => jsxElements({ node: next })));
}

/** One attribute: the renames it needs, or why the site cannot convert. */
function mapAttribute({ attribute }: { attribute: AstNode }): { edits: Edit[]; reason?: string } {
  if (attribute.type !== "JSXAttribute") return { edits: [], reason: "spreads props" };
  const nameNode = child(attribute, "name");
  const name = text(nameNode, "name") ?? "";
  const renamed = RENAMES[name];
  if (!renamed || !nameNode) return { edits: [], reason: `\`${name}\` has no DS equivalent` };
  if (renamed === name) return { edits: [] };
  return { edits: [{ start: nameNode.start, end: nameNode.end, text: renamed }] };
}

function mapSite({ element }: { element: AstNode }): Site {
  const opening = child(element, "openingElement");
  const site: Site = { element, node: opening ?? element, edits: [] };
  for (const attribute of children(opening, "attributes")) {
    const mapped = mapAttribute({ attribute });
    if (mapped.reason) return { ...site, reason: mapped.reason };
    site.edits.push(...mapped.edits);
  }
  return site;
}

/** The import of the ops ConfirmDialog, pointed at the design system. */
function importEdit({ parsed, binding }: { parsed: Parsed; binding: Binding }): Edit {
  const { declaration } = binding;
  const specifiers = children(declaration, "specifiers");
  const name =
    binding.local === "ConfirmDialog" ? "ConfirmDialog" : `ConfirmDialog as ${binding.local}`;
  const line = `import { ${name} } from "${DS_SOURCE}";`;
  if (specifiers.length === 1)
    return { start: declaration.start, end: declaration.end, text: line };
  const own = specifiers.find((node) => text(child(node, "local"), "name") === binding.local);
  const rest = specifiers.filter((node) => node !== own).map((node) => parsed.snippetOf({ node }));
  const sourceNode = child(declaration, "source");
  const from = sourceNode ? parsed.source.slice(sourceNode.start, sourceNode.end) : "";
  return {
    start: declaration.start,
    end: declaration.end,
    text: `${line}\nimport { ${rest.join(", ")} } from ${from};`,
  };
}

export function opsConfirmDialog({ file, source }: { file: string; source: string }): FileOutcome {
  const parsed = parse({ file, source });
  const outcome: FileOutcome = { edits: [], changes: [], skips: [] };
  const binding = [...parsed.bindings.values()].find(
    (entry) => entry.imported === "ConfirmDialog" && OPS_SOURCE.test(entry.source),
  );
  if (!binding) return outcome;
  const sites = jsxElements({ node: parsed.program })
    .filter((element) => {
      const name = child(child(element, "openingElement"), "name");
      return name?.type === "JSXIdentifier" && text(name, "name") === binding.local;
    })
    .map((element) => mapSite({ element }));
  const tags = sites.length + sites.filter((site) => child(site.element, "closingElement")).length;
  const mentions = source.match(new RegExp(`\\b${binding.local}\\b`, "g"))?.length ?? 0;
  const escapes = mentions - 1 > tags;
  const blocked = escapes || sites.some((site) => site.reason);
  for (const site of sites) {
    const line = parsed.lineOf({ offset: site.node.start });
    const snippet = parsed.snippetOf({ node: site.node });
    if (blocked) {
      const fallback = escapes
        ? `\`${binding.local}\` is also used as a value or named in a comment`
        : "maps, but another site in the file does not";
      const reason = site.reason ?? fallback;
      outcome.skips.push({ line, snippet, reason });
      continue;
    }
    outcome.edits.push(...site.edits);
    const after = site.edits
      .toSorted((a, b) => b.start - a.start)
      .reduce(
        (out, edit) =>
          out.slice(0, edit.start - site.node.start) +
          edit.text +
          out.slice(edit.end - site.node.start),
        parsed.source.slice(site.node.start, site.node.end),
      );
    outcome.changes.push({
      line,
      before: snippet,
      after: after.replace(/\s+/g, " ").slice(0, 160),
    });
  }
  if (sites.length && !blocked) {
    const edit = importEdit({ parsed, binding });
    outcome.edits.push(edit);
    const line = parsed.lineOf({ offset: binding.declaration.start });
    const before = parsed.snippetOf({ node: binding.declaration });
    outcome.changes.push({ line, before, after: edit.text });
  }
  return outcome;
}

export const opsConfirmDialogTransform: Transform = {
  name: "ops-confirm-dialog",
  summary: "The ops module's own ConfirmDialog to the design-system ConfirmDialog",
  run: opsConfirmDialog,
};

/**
 * A hand-built yes/no confirmation Dialog to `ConfirmDialog`, only when it matches the row
 * exactly: a title, one sentence, a default Cancel and one primary action. A required
 * reason, a second action, a form or a custom dismissal keeps the Dialog as it is.
 */
import {
  type AstNode,
  type Edit,
  type FileOutcome,
  type Parsed,
  type Transform,
  child,
} from "../ast.ts";
import {
  type Overlay,
  attrValue,
  attrsOf,
  convertFile,
  handlerCode,
  onlyAttrs,
  primitiveOf,
  skip,
} from "../overlay-parts.ts";
import { readOverlay, richCode, titleAttr } from "../overlay-read.ts";

const DS_SOURCE = "@langwatch/design-system/confirm-dialog";

function descriptionOf({ parsed, overlay }: { parsed: Parsed; overlay: Overlay }): string {
  const [only] = overlay.bodyNodes;
  if (overlay.subtitle) {
    if (overlay.bodyNodes.length) skip("has a description and a body");
    return overlay.subtitle;
  }
  if (overlay.bodyNodes.length !== 1 || !only || only.type !== "JSXElement") {
    return skip("body is not one sentence");
  }
  if (primitiveOf({ parsed, element: only }) !== "Text") return skip("body is not one Text");
  const attrs = attrsOf({ opening: child(only, "openingElement") });
  onlyAttrs({ attrs, allowed: [], where: "Text prop" });
  return richCode({ parsed, element: only, what: "sentence" });
}

type Primary = NonNullable<Overlay["footer"]["primarySpec"]>;

function checkShape({ overlay }: { overlay: Overlay }): void {
  const { footer } = overlay;
  if (overlay.onSubmit || overlay.formId) skip("is a form");
  if (overlay.testId || overlay.role) skip("sets a test id or role ConfirmDialog does not take");
  if (overlay.placement) skip("is centred, which ConfirmDialog does not take");
  if (overlay.size && overlay.size !== "md") skip("is wider than a confirmation");
  if (!footer.primarySpec || footer.secondary || footer.destructive || footer.utility.length) {
    skip("is not one primary action and a Cancel");
  }
  if (!footer.cancel || footer.cancel.label) skip("Cancel is not the default one");
}

function checkAction({ spec, waits }: { spec: Primary; waits: string | undefined }): void {
  if (spec.submit || !spec.onClick) skip("confirm is not a plain onClick");
  if (spec.testId) skip("confirm carries a test id");
  if (waits && waits !== spec.disabled && waits !== spec.loading) {
    skip("Cancel waits on something other than the confirm");
  }
  if (spec.disabled && spec.disabled !== spec.loading) skip("confirm is disabled by validation");
  if (spec.palette && !["red", "orange", "blue"].includes(spec.palette)) {
    skip(`colour \`${spec.palette}\``);
  }
  if (spec.variant && spec.variant !== "solid") skip("confirm is not solid");
}

/** The one primary action and a default Cancel: nothing else belongs to a plain confirm. */
function plainPrimary({ overlay }: { overlay: Overlay }): Primary & { onClick: AstNode } {
  checkShape({ overlay });
  const spec = overlay.footer.primarySpec;
  if (!spec?.onClick) return skip("is not one primary action and a Cancel");
  checkAction({ spec, waits: overlay.footer.busy });
  return { ...spec, onClick: spec.onClick };
}

function confirmText({ parsed, overlay }: { parsed: Parsed; overlay: Overlay }): string {
  const spec = plainPrimary({ overlay });
  const props = [
    overlay.open ?? "open",
    `onClose={${overlay.onClose}}`,
    `onConfirm={${handlerCode({ parsed, node: spec.onClick })}}`,
    titleAttr({ title: overlay.title }),
    `description=${descriptionOf({ parsed, overlay })}`,
    `confirmLabel=${attrValue({ code: spec.label ?? '""' })}`,
    spec.palette === "red" ? undefined : 'tone="default"',
    spec.loading && `loading={${spec.loading}}`,
  ].filter((prop) => typeof prop === "string");
  return `<ConfirmDialog ${props.join(" ")} />`;
}

/** The ConfirmDialog import, once, after the Dialog import; none when one is already there. */
function importEdits({ parsed }: { parsed: Parsed }): Edit[] {
  const existing = parsed.bindings.get("ConfirmDialog");
  if (existing) return [];
  const dialog = [...parsed.bindings.values()].find((binding) => binding.imported === "Dialog");
  if (!dialog) return [];
  const end = dialog.declaration.end;
  return [{ start: end, end, text: `\nimport { ConfirmDialog } from "${DS_SOURCE}";` }];
}

export function plainConfirm({ file, source }: { file: string; source: string }): FileOutcome {
  return convertFile({
    file,
    source,
    family: "Dialog",
    addEdits: importEdits,
    convert: ({ parsed, root }) => {
      const existing = parsed.bindings.get("ConfirmDialog");
      if (existing && existing.source !== DS_SOURCE)
        skip("`ConfirmDialog` is another component here");
      const overlay = readOverlay({ parsed, root, family: "Dialog" });
      return { text: confirmText({ parsed, overlay }) };
    },
  });
}

export const plainConfirmTransform: Transform = {
  name: "plain-confirm",
  summary: "Hand-built yes/no Dialogs to ConfirmDialog, only on an exact match",
  run: plainConfirm,
};

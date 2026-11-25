/**
 * A part-built Dialog (Root, Content, Header/Title/Description, Body, Footer) to the
 * callable `<Dialog open onClose title ...>` shape. The default Cancel becomes
 * cancelLabel; a Cancel with its own handler, a Trigger or any unmapped prop is a skip.
 */
import { type FileOutcome, type Transform } from "../ast.ts";
import { type Overlay, attrValue, convertFile, skip } from "../overlay-parts.ts";
import { readOverlay, titleAttr } from "../overlay-read.ts";

export function renderDialog({ overlay }: { overlay: Overlay }): string {
  const { footer } = overlay;
  if (footer.secondary && footer.cancel) skip("a secondary action takes Cancel's place");
  if (!footer.secondary && !footer.cancel) skip("no Cancel: the shape draws one");
  const props = [
    overlay.open,
    `onClose={${overlay.onClose}}`,
    overlay.size && `size="${overlay.size}"`,
    overlay.placement && `placement="${overlay.placement}"`,
    titleAttr({ title: overlay.title }),
    overlay.subtitle && `description=${overlay.subtitle}`,
    overlay.role,
    overlay.onSubmit && `onSubmit={${overlay.onSubmit}}`,
    overlay.formId && `formId=${overlay.formId}`,
    footer.primary && `primaryAction={${footer.primary}}`,
    footer.secondary && `secondaryAction={${footer.secondary}}`,
    footer.cancel?.label && `cancelLabel=${attrValue({ code: footer.cancel.label })}`,
    footer.busy && `busy={${footer.busy}}`,
    overlay.testId,
  ].filter((prop) => typeof prop === "string");
  const open = `<Dialog ${props.join(" ")}`;
  return overlay.body.trim() ? `${open}>${overlay.body}</Dialog>` : `${open} />`;
}

export function simpleDialog({ file, source }: { file: string; source: string }): FileOutcome {
  return convertFile({
    file,
    source,
    family: "Dialog",
    convert: ({ parsed, root }) => ({
      text: renderDialog({ overlay: readOverlay({ parsed, root, family: "Dialog" }) }),
    }),
  });
}

export const simpleDialogTransform: Transform = {
  name: "simple-dialog",
  summary: "Part-built Dialog.Root compositions to the callable Dialog shape (default Cancel kept)",
  run: simpleDialog,
};

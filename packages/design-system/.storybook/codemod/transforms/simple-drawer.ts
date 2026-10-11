/**
 * A part-built Drawer (Root, Content, Header/Title, Body, Footer, CloseTrigger) to the
 * callable `<Drawer title onClose footer>` shape. Cancel leaves the footer (ruling Q2: the
 * X and Escape close); anything outside the mapping table is a skip with its reason.
 */
import { type FileOutcome, type Transform } from "../ast.ts";
import { footerCode, convertFile } from "../overlay-parts.ts";
import { type Overlay } from "../overlay-parts.ts";
import { readOverlay, titleAttr } from "../overlay-read.ts";

export function renderDrawer({ overlay }: { overlay: Overlay }): string {
  const footer = footerCode({ footer: overlay.footer });
  const props = [
    overlay.open,
    `onClose={${overlay.onClose}}`,
    overlay.size && `size="${overlay.size}"`,
    titleAttr({ title: overlay.title }),
    overlay.subtitle && `subtitle=${overlay.subtitle}`,
    overlay.flush && 'body="flush"',
    overlay.onSubmit && `onSubmit={${overlay.onSubmit}}`,
    overlay.formId && `formId=${overlay.formId}`,
    overlay.footer.busy && `busy={${overlay.footer.busy}}`,
    overlay.testId,
    footer && `footer={${footer}}`,
  ].filter((prop) => typeof prop === "string");
  const open = `<Drawer ${props.join(" ")}`;
  return overlay.body.trim() ? `${open}>${overlay.body}</Drawer>` : `${open} />`;
}

export function simpleDrawer({ file, source }: { file: string; source: string }): FileOutcome {
  return convertFile({
    file,
    source,
    family: "Drawer",
    convert: ({ parsed, root }) => ({
      text: renderDrawer({ overlay: readOverlay({ parsed, root, family: "Drawer" }) }),
    }),
  });
}

export const simpleDrawerTransform: Transform = {
  name: "simple-drawer",
  summary:
    "Part-built Drawer.Root compositions to the callable Drawer shape (no Cancel in footers)",
  run: simpleDrawer,
};

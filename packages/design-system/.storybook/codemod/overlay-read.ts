/**
 * Reads one part-built Drawer or Dialog (Root > Content > Header, Body, Footer) into an
 * `Overlay`, or throws `Skipped` naming the first thing outside the mapping table.
 */
import { type AstNode, type Parsed, child, sourceOf } from "./ast.ts";
import {
  type Attr,
  type CloseRequest,
  type Family,
  type FooterModel,
  type Overlay,
  attrNamed,
  attrValue,
  attrsOf,
  familyLocal,
  literalOf,
  meaningful,
  onlyAttrs,
  partOf,
  readActions,
  readButtons,
  closeRequestOf,
  skip,
  stringCode,
  valueCode,
} from "./overlay-parts.ts";

const DRAWER_SIZES: Record<string, string> = {
  sm: "sm",
  md: "md",
  lg: "lg",
  xl: "xl",
  full: "full",
  "2xl": "lg",
};
const DIALOG_SIZES: Record<string, string> = { sm: "sm", md: "md", lg: "lg", xl: "xl" };

function sizeCode({
  family,
  attr,
}: {
  family: Family;
  attr: Attr | undefined;
}): string | undefined {
  const value = attr ? literalOf({ node: attr.value }) : undefined;
  if (attr && typeof value !== "string") return skip("size is not a literal");
  if (family === "Drawer") {
    const mapped = value === undefined ? "xl" : DRAWER_SIZES[String(value)];
    if (!mapped) return skip(`drawer size \`${value}\` has no slot`);
    return mapped === "md" ? undefined : mapped;
  }
  const mapped = value === undefined ? "md" : DIALOG_SIZES[String(value)];
  if (!mapped) return skip(`dialog size \`${value}\` has no slot`);
  return mapped === "sm" ? undefined : mapped;
}

/** The shape's size for a literal pixel or rem maxWidth, by the spec's width mapping. */
export function widthBucket({ px }: { px: number }): string | undefined {
  if (px <= 480) return "sm";
  if (px >= 500 && px <= 576) return "md";
  if (px >= 600 && px <= 800) return "lg";
  if (px >= 880 && px <= 1040) return "xl";
  return undefined;
}

export function pixelsOf({ node }: { node: AstNode | undefined }): number | undefined {
  const value = literalOf({ node });
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * (match[2] === "rem" ? 16 : 1);
}

type ContentRead = Pick<Overlay, "testId" | "onSubmit" | "formId" | "maxWidthPx"> & {
  ownedForm: boolean;
};

function readContentAttrs({
  parsed,
  family,
  attrs,
}: {
  parsed: Parsed;
  family: Family;
  attrs: Attr[];
}): ContentRead {
  const allowed = ["data-testid", "as", "onSubmit", "id", family === "Drawer" ? "bg" : "maxWidth"];
  onlyAttrs({
    attrs,
    allowed: family === "Dialog" ? [...allowed, "maxW"] : allowed,
    where: `${family}.Content prop`,
  });
  const bg = attrNamed({ attrs, name: "bg" });
  if (bg && literalOf({ node: bg.value }) !== "bg") skip("Content has its own ground");
  const as = attrNamed({ attrs, name: "as" });
  const submit = attrNamed({ attrs, name: "onSubmit" });
  const id = attrNamed({ attrs, name: "id" });
  if (as && literalOf({ node: as.value }) !== "form") skip("Content `as` is not a form");
  if (Boolean(as) !== Boolean(submit))
    skip("Content form without onSubmit, or onSubmit without a form");
  if (id && !as) skip("Content `id` outside a form");
  const width = attrNamed({ attrs, name: "maxWidth" }) ?? attrNamed({ attrs, name: "maxW" });
  const maxWidthPx = width ? pixelsOf({ node: width.value }) : undefined;
  if (width && maxWidthPx === undefined) skip("maxWidth is not a literal px or rem");
  const testId = attrNamed({ attrs, name: "data-testid" });
  return {
    testId: testId ? sourceOf({ parsed, node: testId.node }) : undefined,
    onSubmit: submit ? valueCode({ parsed, attr: submit }) : undefined,
    formId: id ? attrValue({ code: valueCode({ parsed, attr: id }) }) : undefined,
    maxWidthPx,
    ownedForm: as !== undefined,
  };
}

export function richCode({
  parsed,
  element,
  what,
}: {
  parsed: Parsed;
  element: AstNode;
  what: string;
}): string {
  const nodes = meaningful({ element });
  const [only] = nodes;
  if (nodes.length === 1 && only?.type === "JSXText") {
    return attrValue({ code: stringCode({ parsed, nodes, what }) });
  }
  if (nodes.length === 1 && only?.type === "JSXExpressionContainer") {
    const expression = child(only, "expression");
    if (!expression || expression.type === "JSXEmptyExpression") return skip(`${what} is empty`);
    return `{${sourceOf({ parsed, node: expression })}}`;
  }
  if (nodes.length === 1 && only?.type === "JSXElement")
    return `{${sourceOf({ parsed, node: only })}}`;
  return skip(`${what} is more than one child`);
}

function noAttrs({ element, where }: { element: AstNode; where: string }): void {
  const attrs = attrsOf({ opening: child(element, "openingElement") });
  onlyAttrs({ attrs, allowed: [], where });
}

/** The X is the shape's: a CloseTrigger with a click handler of its own is not mechanical. */
function checkCloseTrigger({ node, family }: { node: AstNode; family: Family }) {
  noAttrs({ element: node, where: `${family}.CloseTrigger prop` });
  if (meaningful({ element: node }).length) skip("CloseTrigger has children");
}

type Ctx = { parsed: Parsed; family: Family; close: CloseRequest };
type HeaderRead = { title?: string; subtitle?: string };

function readDescription({ ctx, node }: { ctx: Ctx; node: AstNode }): string {
  const { parsed, family } = ctx;
  const attrs = attrsOf({ opening: child(node, "openingElement") });
  const where = `${family}.Description prop`;
  onlyAttrs({ attrs, allowed: ["color", "fontSize", "textStyle"], where });
  for (const attr of attrs) {
    const value = literalOf({ node: attr.value });
    if (value !== "fg.muted" && value !== "sm")
      skip(`${family}.Description \`${attr.name}\` value`);
  }
  return richCode({ parsed, element: node, what: "description" });
}

function readHeaderPart({ ctx, node, into }: { ctx: Ctx; node: AstNode; into: HeaderRead }): void {
  const { parsed, family } = ctx;
  const part = node.type === "JSXElement" ? partOf({ parsed, element: node, family }) : undefined;
  if (part === "Title" && into.title === undefined) {
    noAttrs({ element: node, where: `${family}.Title prop` });
    into.title = stringCode({ parsed, nodes: meaningful({ element: node }), what: "title" });
  } else if (part === "Description" && into.subtitle === undefined) {
    into.subtitle = readDescription({ ctx, node });
  } else if (part === "CloseTrigger") {
    checkCloseTrigger({ node, family });
  } else {
    skip("Header holds more than Title, Description and CloseTrigger");
  }
}

function readHeader({ ctx, header }: { ctx: Ctx; header: AstNode }) {
  noAttrs({ element: header, where: `${ctx.family}.Header prop` });
  const into: HeaderRead = {};
  for (const node of meaningful({ element: header })) readHeaderPart({ ctx, node, into });
  if (into.title === undefined) return skip("Header has no Title");
  return { title: into.title, subtitle: into.subtitle };
}

function readBody({
  parsed,
  body,
  family,
  local,
}: {
  parsed: Parsed;
  body: AstNode;
  family: Family;
  local: string;
}) {
  const attrs = attrsOf({ opening: child(body, "openingElement") });
  onlyAttrs({
    attrs,
    allowed: family === "Drawer" ? ["padding", "p"] : ["paddingBottom", "pb"],
    where: `${family}.Body prop`,
  });
  const padding = attrs.find((attr) => attr.name === "padding" || attr.name === "p");
  const value = padding ? literalOf({ node: padding.value }) : undefined;
  if (padding && value !== 0 && value !== "0") skip("Body padding is not zero");
  const opening = child(body, "openingElement");
  const closing = child(body, "closingElement");
  const inner = opening && closing ? parsed.source.slice(opening.end, closing.start) : "";
  if (new RegExp(`\\b${local}\\.`).test(inner)) skip(`Body uses ${family} parts`);
  return { flush: padding !== undefined, inner, nodes: meaningful({ element: body }) };
}

const FORM_LIBRARY = /useForm|FormProvider/;

type RootRead = {
  open?: string;
  sizeAttr?: Attr;
  placement?: string;
  role?: string;
  close: CloseRequest;
  content: AstNode;
};

function openCode({ parsed, family, attr }: { parsed: Parsed; family: Family; attr: Attr }) {
  const bare = attr.value === undefined || literalOf({ node: attr.value }) === true;
  if (!bare) return `open={${valueCode({ parsed, attr })}}`;
  return family === "Dialog" ? "open" : undefined;
}

function readRoot({
  parsed,
  root,
  family,
}: {
  parsed: Parsed;
  root: AstNode;
  family: Family;
}): RootRead {
  const attrs = attrsOf({ opening: child(root, "openingElement") });
  const allowed = [
    "open",
    "onOpenChange",
    "size",
    "placement",
    ...(family === "Dialog" ? ["role"] : []),
  ];
  onlyAttrs({ attrs, allowed, where: `${family}.Root prop` });
  const openAttr = attrNamed({ attrs, name: "open" });
  if (!openAttr) return skip("no `open` prop (a Trigger opens it)");
  const placement = attrNamed({ attrs, name: "placement" });
  const placementValue = placement ? literalOf({ node: placement.value }) : undefined;
  if (family === "Drawer" && placement && placementValue !== "end") skip("placement is not end");
  if (family === "Dialog" && placement && !["top", "center"].includes(String(placementValue))) {
    skip("placement is not top or center");
  }
  const role = attrNamed({ attrs, name: "role" });
  const roleValue = role ? literalOf({ node: role.value }) : undefined;
  if (role && roleValue !== "alertdialog" && roleValue !== "dialog") skip("role is dynamic");
  const close = closeRequestOf({ parsed, attr: attrNamed({ attrs, name: "onOpenChange" }) });
  const [content, ...more] = meaningful({ element: root });
  if (!content || more.length || partOf({ parsed, element: content, family }) !== "Content") {
    return skip("Root holds more than one Content");
  }
  return {
    open: openCode({ parsed, family, attr: openAttr }),
    sizeAttr: attrNamed({ attrs, name: "size" }),
    placement: family === "Dialog" && placementValue === "center" ? "center" : undefined,
    role: roleValue === undefined ? undefined : `role="${roleValue}"`,
    close,
    content,
  };
}

type ContentState = {
  header?: { title: string; subtitle?: string };
  body: { flush: boolean; inner: string; nodes: AstNode[] };
  footer?: FooterModel;
  closeTriggers: number;
};

function readFooter({ ctx, node, ownedForm }: { ctx: Ctx; node: AstNode; ownedForm: boolean }) {
  const { parsed, family, close } = ctx;
  noAttrs({ element: node, where: `${family}.Footer prop` });
  const parts = meaningful({ element: node });
  const [first] = parts;
  if (parts.length === 1 && first && partOf({ parsed, element: first, family }) === "Actions") {
    return readActions({ parsed, element: first, close, ownedForm });
  }
  return readButtons({ parsed, nodes: parts, family, close, ownedForm });
}

function readContentPart({
  ctx,
  node,
  state,
  ownedForm,
  local,
}: {
  ctx: Ctx;
  node: AstNode;
  state: ContentState;
  ownedForm: boolean;
  local: string;
}): void {
  const { parsed, family, close } = ctx;
  const part = node.type === "JSXElement" ? partOf({ parsed, element: node, family }) : undefined;
  if (part === "Header" && !state.header) {
    state.header = readHeader({ ctx, header: node });
  } else if (part === "Body") {
    state.body = readBody({ parsed, body: node, family, local });
  } else if (part === "Footer" && !state.footer) {
    state.footer = readFooter({ ctx, node, ownedForm });
  } else if (part === "Actions" && !state.footer && family === "Drawer") {
    state.footer = readActions({ parsed, element: node, close, ownedForm });
  } else if (part === "CloseTrigger" && state.closeTriggers === 0) {
    checkCloseTrigger({ node, family });
    state.closeTriggers += 1;
  } else {
    skip("Content holds parts outside Header, Body, Footer and CloseTrigger");
  }
}

function sizeFor({
  family,
  sizeAttr,
  maxWidthPx,
}: {
  family: Family;
  sizeAttr: Attr | undefined;
  maxWidthPx: number | undefined;
}): string | undefined {
  if (maxWidthPx === undefined) return sizeCode({ family, attr: sizeAttr });
  const bucket = widthBucket({ px: maxWidthPx });
  if (!bucket) return skip("maxWidth fits no size");
  return bucket === "sm" ? undefined : bucket;
}

export function readOverlay({
  parsed,
  root,
  family,
}: {
  parsed: Parsed;
  root: AstNode;
  family: Family;
}): Overlay {
  const local = familyLocal({ parsed, family }) ?? family;
  const { open, sizeAttr, placement, role, close, content } = readRoot({ parsed, root, family });
  const ctx: Ctx = { parsed, family, close };
  const read = readContentAttrs({
    parsed,
    family,
    attrs: attrsOf({ opening: child(content, "openingElement") }),
  });
  const state: ContentState = { body: { flush: false, inner: "", nodes: [] }, closeTriggers: 0 };
  for (const node of meaningful({ element: content })) {
    readContentPart({ ctx, node, state, ownedForm: read.ownedForm, local });
  }
  if (!state.header) return skip("no Header");
  const footer = state.footer ?? { utility: [], childForm: false };
  if (FORM_LIBRARY.test(parsed.source) && !read.ownedForm && !footer.childForm) {
    skip("form library without a form submit action");
  }
  return {
    family,
    open,
    onClose: close.code,
    size: sizeFor({
      family: family,
      sizeAttr,
      maxWidthPx: family === "Dialog" ? read.maxWidthPx : undefined,
    }),
    placement,
    role,
    testId: read.testId,
    title: state.header.title,
    subtitle: state.header.subtitle,
    flush: state.body.flush,
    onSubmit: read.onSubmit,
    formId: read.formId,
    body: state.body.inner,
    bodyNodes: state.body.nodes,
    footer,
    maxWidthPx: read.maxWidthPx,
  };
}

export const titleAttr = ({ title }: { title: string }) => `title=${attrValue({ code: title })}`;

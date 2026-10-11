/**
 * What the drawer, dialog and confirm transforms share: reading a part-built overlay
 * (Root, Content, Header, Title, Body, Footer, buttons) into one model, and the reasons it
 * cannot. Anything outside the mapping table throws `Skipped`; the caller records the skip.
 */
import {
  type AstNode,
  type Edit,
  type FileOutcome,
  type Parsed,
  applyEdits,
  child,
  children,
  isDesignSystemSource,
  jsxElements,
  parse,
  pruneImports,
  resolveElement,
  sourceOf,
  text,
} from "./ast.ts";

export type Family = "Drawer" | "Dialog";
export const FAMILY_SOURCE: Record<Family, string> = {
  Drawer: "@langwatch/design-system/drawer",
  Dialog: "@langwatch/design-system/dialog",
};

export class Skipped extends Error {}
export function skip(reason: string): never {
  throw new Skipped(reason);
}

/** Overlays a person owns: special hosts, the upgrade module, experiments, scenarios, traces. */
const OWNED_ELSEWHERE =
  /\/upgrades?\/|(^|\/)modules\/(experiment|scenario|trace)\/|trace-drawer-shell|studio-drawer-wrapper|studio-drawer-footer|dataset-modal|optimize\.tsx|invite-member-drawer|virtual-key-secret-reveal/;
export const ownedElsewhere = ({ file }: { file: string }) => OWNED_ELSEWHERE.test(file);

export type Attr = { name: string; node: AstNode; value: AstNode | undefined };

export function attrsOf({ opening }: { opening: AstNode | undefined }): Attr[] {
  return children(opening, "attributes").map((node) => {
    if (node.type !== "JSXAttribute") return skip("spreads props");
    const value = child(node, "value");
    const inner = value?.type === "JSXExpressionContainer" ? child(value, "expression") : value;
    return { name: text(child(node, "name"), "name") ?? "", node, value: inner };
  });
}

export function literalOf({ node }: { node: AstNode | undefined }) {
  if (node?.type !== "Literal") return undefined;
  const value = node.value;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : undefined;
}

/** Only these attributes may appear; anything else names itself as the reason. */
export function onlyAttrs({
  attrs,
  allowed,
  where,
}: {
  attrs: Attr[];
  allowed: string[];
  where: string;
}): void {
  const extra = attrs.find((attr) => !allowed.includes(attr.name));
  if (extra) skip(`${where} \`${extra.name}\` is outside the mapping`);
}

export const attrNamed = ({ attrs, name }: { attrs: Attr[]; name: string }) =>
  attrs.find((attr) => attr.name === name);

/** The attribute's value as source: `true` for a bare attribute. */
export function valueCode({ parsed, attr }: { parsed: Parsed; attr: Attr }): string {
  return attr.value ? sourceOf({ parsed, node: attr.value }) : "true";
}

export function meaningful({ element }: { element: AstNode }): AstNode[] {
  return children(element, "children").filter(
    (node) => !(node.type === "JSXText" && (text(node, "value") ?? "").trim() === ""),
  );
}

export function partOf({
  parsed,
  element,
  family,
}: {
  parsed: Parsed;
  element: AstNode;
  family: Family;
}): string | undefined {
  const resolved = resolveElement({ parsed, opening: child(element, "openingElement") ?? element });
  const binding = resolved?.binding;
  if (binding?.imported !== family || binding.source !== FAMILY_SOURCE[family]) return undefined;
  return resolved?.ref.split(".")[1];
}

/** Which design-system primitive an element is, by import: `Button`, `HStack`, `Text`... */
export function primitiveOf({ parsed, element }: { parsed: Parsed; element: AstNode }) {
  const resolved = resolveElement({ parsed, opening: child(element, "openingElement") ?? element });
  const binding = resolved?.binding;
  if (!binding || !isDesignSystemSource(binding.source)) return undefined;
  return resolved?.ref;
}

export function rootsOf({ parsed, family }: { parsed: Parsed; family: Family }): AstNode[] {
  return jsxElements({ node: parsed.program }).filter(
    (element) => partOf({ parsed, element, family }) === "Root",
  );
}

export function familyLocal({ parsed, family }: { parsed: Parsed; family: Family }) {
  return [...parsed.bindings.values()].find(
    (binding) => binding.imported === family && binding.source === FAMILY_SOURCE[family],
  )?.local;
}

const SPECIAL = /[&{}<>"\\]/;

/** An expression that is certainly a string: a literal, a template or a choice of those. */
export function isStringish({ node }: { node: AstNode | undefined }): boolean {
  if (!node) return false;
  if (node.type === "Literal") return typeof node.value === "string";
  if (node.type === "TemplateLiteral") return true;
  if (node.type === "ConditionalExpression") {
    return (
      isStringish({ node: child(node, "consequent") }) &&
      isStringish({ node: child(node, "alternate") })
    );
  }
  return false;
}

/** A plain string from JSX children, as code: `"Save"` or the expression's source. */
export function stringCode({
  parsed,
  nodes,
  what,
}: {
  parsed: Parsed;
  nodes: AstNode[];
  what: string;
}): string {
  const [only] = nodes;
  if (nodes.length === 1 && only?.type === "JSXText") {
    const value = (text(only, "value") ?? "").replace(/\s+/g, " ").trim();
    if (!value || SPECIAL.test(value)) return skip(`${what} text has markup or an entity`);
    return JSON.stringify(value);
  }
  const expression =
    only?.type === "JSXExpressionContainer" ? child(only, "expression") : undefined;
  if (nodes.length === 1 && expression && isStringish({ node: expression })) {
    return sourceOf({ parsed, node: expression });
  }
  return templateCode({ parsed, nodes }) ?? skip(`${what} is not a plain string`);
}

/** Single-line text around string expressions, as one template literal. */
function templateCode({ parsed, nodes }: { parsed: Parsed; nodes: AstNode[] }): string | undefined {
  if (nodes.length < 2) return undefined;
  const parts = nodes.map((node) => {
    if (node.type === "JSXText") {
      const value = text(node, "value") ?? "";
      return /[\n&`$\\]/.test(value) ? undefined : value;
    }
    const expression =
      node.type === "JSXExpressionContainer" ? child(node, "expression") : undefined;
    return isStringish({ node: expression }) && expression
      ? `\${${sourceOf({ parsed, node: expression })}}`
      : undefined;
  });
  return parts.every((part) => part !== undefined) ? `\`${parts.join("")}\`` : undefined;
}

/** Code as an attribute value: `"x"` stays, anything else takes braces. */
export const attrValue = ({ code }: { code: string }) =>
  /^"[^"\\{}]*"$/.test(code) ? code : `{${code}}`;

const squash = (value: string) => value.replace(/\s+/g, "");

export type CloseRequest = { code: string; key: string };

/** `onOpenChange={({ open }) => { if (!open) close(); }}` read as a pure close request. */
export function closeRequestOf({
  parsed,
  attr,
}: {
  parsed: Parsed;
  attr: Attr | undefined;
}): CloseRequest {
  const arrow = attr?.value;
  if (arrow?.type !== "ArrowFunctionExpression") return skip("no close handler (onOpenChange)");
  const [param] = children(arrow, "params");
  const body = child(arrow, "body");
  const inner = body?.type === "BlockStatement" ? only({ nodes: children(body, "body") }) : body;
  if (!param) return closeCall({ parsed, node: inner });
  const openName = openFlagName({ param });
  const passed = passThrough({ parsed, node: inner, name: openName });
  if (passed) return passed;
  const guarded =
    inner?.type === "IfStatement" ? ifBranch({ node: inner }) : andBranch({ node: inner });
  if (!openName || !guarded || !isNegatedFlag({ node: guarded.test, name: openName })) {
    return skip("close handler is not a plain `if (!open) close()`");
  }
  return closeCall({ parsed, node: guarded.action });
}

/** `setOpen(open)`: the flag handed straight on; closing is the same call with false. */
function passThrough({
  parsed,
  node,
  name,
}: {
  parsed: Parsed;
  node: AstNode | undefined;
  name: string | undefined;
}): CloseRequest | undefined {
  const call = node?.type === "ExpressionStatement" ? child(node, "expression") : node;
  const callee = child(call, "callee");
  const [argument, ...rest] = children(call, "arguments");
  if (call?.type !== "CallExpression" || !callee) return undefined;
  if (!name || !argument || rest.length) return undefined;
  if (!isFlag({ node: argument, name })) return undefined;
  const code = `${sourceOf({ parsed, node: callee })}(false)`;
  return { code: `() => ${code}`, key: squash(code) };
}

function isFlag({ node, name }: { node: AstNode; name: string }): boolean {
  if (node.type === "Identifier") return text(node, "name") === name;
  if (node.type !== "MemberExpression") return false;
  return `${text(child(node, "object"), "name")}.${text(child(node, "property"), "name")}` === name;
}

/** A lone call as the close request: a bare name passes through, anything else is wrapped. */
function closeCall({ parsed, node }: { parsed: Parsed; node: AstNode | undefined }): CloseRequest {
  const statement = node?.type === "ExpressionStatement" ? child(node, "expression") : node;
  if (statement?.type !== "CallExpression") return skip("close handler does more than one call");
  const callee = child(statement, "callee");
  const callSource = sourceOf({ parsed, node: statement });
  const bare = callee?.type === "Identifier" && children(statement, "arguments").length === 0;
  return {
    code: bare ? sourceOf({ parsed, node: callee }) : `() => ${callSource}`,
    key: squash(callSource),
  };
}

type Guard = { test: AstNode; action: AstNode | undefined };

function only({ nodes }: { nodes: AstNode[] }): AstNode | undefined {
  return nodes.length === 1 ? nodes[0] : undefined;
}

function ifBranch({ node }: { node: AstNode }): Guard | undefined {
  const test = child(node, "test");
  const consequent = child(node, "consequent");
  if (!test || node.alternate) return undefined;
  const action =
    consequent?.type === "BlockStatement"
      ? only({ nodes: children(consequent, "body") })
      : consequent;
  return { test, action };
}

function andBranch({ node }: { node: AstNode | undefined }): Guard | undefined {
  if (node?.type !== "LogicalExpression" || node.operator !== "&&") return undefined;
  const test = child(node, "left");
  return test ? { test, action: child(node, "right") } : undefined;
}

function openFlagName({ param }: { param: AstNode | undefined }): string | undefined {
  if (param?.type === "Identifier") return `${text(param, "name")}.open`;
  if (param?.type !== "ObjectPattern") return undefined;
  const property = children(param, "properties").find(
    (prop) => text(child(prop, "key"), "name") === "open",
  );
  return text(child(property, "value"), "name");
}

function isNegatedFlag({ node, name }: { node: AstNode; name: string }): boolean {
  const argument = child(node, "argument");
  return (
    node.type === "UnaryExpression" &&
    node.operator === "!" &&
    argument !== undefined &&
    isFlag({ node: argument, name })
  );
}

export type ButtonSpec = {
  label?: string;
  plain?: string;
  onClick?: AstNode;
  submit: boolean;
  form?: string;
  loading?: string;
  disabled?: string;
  palette?: string;
  variant?: string;
  testId?: string;
};

const BUTTON_ATTRS = [
  "onClick",
  "type",
  "form",
  "loading",
  "disabled",
  "colorPalette",
  "colorScheme",
  "variant",
  "size",
  "data-testid",
];

export function buttonSpec({ parsed, element }: { parsed: Parsed; element: AstNode }): ButtonSpec {
  if (primitiveOf({ parsed, element }) !== "Button") return skip("footer holds a non-Button");
  const opening = child(element, "openingElement");
  const attrs = attrsOf({ opening });
  onlyAttrs({ attrs, allowed: BUTTON_ATTRS, where: "Button prop" });
  const nodes = meaningful({ element });
  const label = stringCode({ parsed, nodes, what: "Button label" });
  const get = (name: string) => attrNamed({ attrs, name });
  const str = (name: string) => literalOf({ node: get(name)?.value });
  const attr = (name: string) => {
    const found = get(name);
    return found ? valueCode({ parsed, attr: found }) : undefined;
  };
  for (const name of ["type", "colorPalette", "colorScheme", "variant"]) {
    if (get(name) && typeof str(name) !== "string") skip(`Button \`${name}\` is dynamic`);
  }
  const type = str("type");
  if (type !== undefined && type !== "submit" && type !== "button") skip("Button type is unknown");
  return {
    label,
    plain: label.startsWith('"') ? JSON.parse(label) : undefined,
    onClick: get("onClick")?.value,
    submit: type === "submit",
    form: attr("form"),
    loading: attr("loading"),
    disabled: attr("disabled"),
    palette: String(str("colorPalette") ?? str("colorScheme") ?? ""),
    variant: str("variant")?.toString(),
    testId: attr("data-testid"),
  };
}

export type Role = "primary" | "secondary" | "destructive" | "utility";

function checkLook({ spec, role }: { spec: ButtonSpec; role: Role }): void {
  const { palette, variant } = spec;
  if (role === "primary") {
    if (variant && variant !== "solid") skip("primary is not a solid Button");
    if (palette && !["orange", "blue", "red"].includes(palette)) skip(`colour \`${palette}\``);
    return;
  }
  if (role === "destructive") {
    if (palette !== "red") skip("destructive action is not red");
    return;
  }
  if (palette && palette !== "gray") skip(`colour \`${palette}\``);
}

function actionFields({
  parsed,
  spec,
  ownedForm,
}: {
  parsed: Parsed;
  spec: ButtonSpec;
  ownedForm: boolean;
}): string[] {
  if (!spec.submit) {
    if (!spec.onClick) return skip("Button without onClick");
    return [`onClick: ${handlerCode({ parsed, node: spec.onClick })}`];
  }
  if (spec.onClick) skip("submit Button also has onClick");
  if (!spec.form && !ownedForm) skip("submit Button without a form");
  return ['type: "submit"', ...(spec.form ? [`form: ${spec.form}`] : [])];
}

/** One footer button as a `FrameAction` object literal; `ownedForm` lets a bare submit stand. */
export function describe({
  parsed,
  spec,
  role,
  ownedForm,
}: {
  parsed: Parsed;
  spec: ButtonSpec;
  role: Role;
  ownedForm: boolean;
}): { code: string; childForm: boolean } {
  checkLook({ spec, role });
  const fields = [`label: ${spec.label}`, ...actionFields({ parsed, spec, ownedForm })];
  if (spec.disabled && spec.disabled !== spec.loading) skip("disabled is validation state");
  if (spec.loading) fields.push(`loading: ${spec.loading}`);
  if (role === "primary" && spec.palette === "red") fields.push("danger: true");
  if (spec.testId) fields.push(`"data-testid": ${spec.testId}`);
  return { code: `{ ${fields.join(", ")} }`, childForm: spec.submit && spec.form !== undefined };
}

/** A zero-argument callback or a reference; an arrow that takes arguments is not an intent. */
export function handlerCode({ parsed, node }: { parsed: Parsed; node: AstNode }): string {
  if (node.type === "ArrowFunctionExpression" && children(node, "params").length > 0) {
    return skip("onClick takes arguments");
  }
  return sourceOf({ parsed, node });
}

/** Whether a Cancel button's onClick is the same close request as the Root's. */
export function closesLikeRoot({
  parsed,
  onClick,
  close,
}: {
  parsed: Parsed;
  onClick: AstNode | undefined;
  close: CloseRequest;
}): boolean {
  if (!onClick) return false;
  if (onClick.type === "Identifier")
    return `${squash(sourceOf({ parsed, node: onClick }))}()` === close.key;
  if (onClick.type !== "ArrowFunctionExpression" || children(onClick, "params").length > 0)
    return false;
  const body = child(onClick, "body");
  const inner = body?.type === "BlockStatement" ? only({ nodes: children(body, "body") }) : body;
  const call = inner?.type === "ExpressionStatement" ? child(inner, "expression") : inner;
  return call !== undefined && squash(sourceOf({ parsed, node: call })) === close.key;
}

export type FooterModel = {
  primary?: string;
  secondary?: string;
  destructive?: string;
  utility: string[];
  cancel?: { label?: string; onClick?: string };
  busy?: string;
  childForm: boolean;
  primarySpec?: ButtonSpec;
};

export type Overlay = {
  family: Family;
  open?: string;
  onClose: string;
  size?: string;
  placement?: string;
  role?: string;
  testId?: string;
  title: string;
  subtitle?: string;
  flush: boolean;
  onSubmit?: string;
  formId?: string;
  body: string;
  bodyNodes: AstNode[];
  footer: FooterModel;
  maxWidthPx?: number;
};

const WRAPPERS = ["HStack", "Flex", "Box", "Stack"];
const WRAPPER_ATTRS = ["width", "w", "justify", "justifyContent", "gap", "spacing", "align"];

type Use = { element: AstNode; wrapped: boolean };

function wrappedButton({ node }: { node: AstNode }): Use[] {
  const attrs = attrsOf({ opening: child(node, "openingElement") });
  onlyAttrs({ attrs, allowed: ["asChild"], where: "ActionTrigger" });
  const inner = meaningful({ element: node });
  const [only] = inner;
  if (inner.length !== 1 || only?.type !== "JSXElement") {
    return skip("ActionTrigger does not wrap one Button");
  }
  return [{ element: only, wrapped: true }];
}

function useOf({
  parsed,
  node,
  family,
  depth,
}: {
  parsed: Parsed;
  node: AstNode;
  family: Family;
  depth: number;
}): Use[] {
  if (node.type !== "JSXElement") return skip("footer has other content");
  if (partOf({ parsed, element: node, family }) === "ActionTrigger") return wrappedButton({ node });
  const primitive = primitiveOf({ parsed, element: node });
  if (primitive === "Button") return [{ element: node, wrapped: false }];
  if (primitive === "Spacer") return [];
  if (!primitive || !WRAPPERS.includes(primitive) || depth > 0) {
    return skip("footer has other content");
  }
  const attrs = attrsOf({ opening: child(node, "openingElement") });
  onlyAttrs({ attrs, allowed: WRAPPER_ATTRS, where: "footer wrapper" });
  return footerUses({ parsed, nodes: meaningful({ element: node }), family, depth: 1 });
}

function footerUses({
  parsed,
  nodes,
  family,
  depth = 0,
}: {
  parsed: Parsed;
  nodes: AstNode[];
  family: Family;
  depth?: number;
}): Use[] {
  return nodes.flatMap((node) => useOf({ parsed, node, family, depth }));
}

const CANCEL_TEXT = /^(cancel|close)$/i;

function isCancel({
  spec,
  wrapped,
  family,
}: {
  spec: ButtonSpec;
  wrapped: boolean;
  family: Family;
}): boolean {
  const cancelText = spec.plain !== undefined && CANCEL_TEXT.test(spec.plain);
  if (wrapped && (family === "Dialog" || cancelText)) return true;
  return cancelText && !spec.submit;
}

function takeCancel({
  parsed,
  model,
  spec,
  wrapped,
  family,
  close,
}: {
  parsed: Parsed;
  model: FooterModel;
  spec: ButtonSpec;
  wrapped: boolean;
  family: Family;
  close: CloseRequest;
}): void {
  if (model.cancel) skip("two Cancel buttons");
  const own = wrapped
    ? spec.onClick !== undefined
    : !closesLikeRoot({ parsed, onClick: spec.onClick, close });
  if (own && (family === "Dialog" || wrapped)) skip("Cancel has its own handler");
  if (spec.disabled) model.busy = spec.disabled;
  const label = spec.plain !== undefined && /^cancel$/i.test(spec.plain) ? undefined : spec.label;
  if (family === "Dialog") {
    model.cancel = label === undefined ? {} : { label };
    return;
  }
  if (!wrapped && !spec.onClick) skip("Cancel without onClick");
  const onClick = spec.onClick ? handlerCode({ parsed, node: spec.onClick }) : close.code;
  model.cancel = label === undefined ? { onClick } : { label, onClick };
}

/** The footer's plain Buttons classified: Cancel dropped, the rest primary and secondary. */
export function readButtons({
  parsed,
  nodes,
  family,
  close,
  ownedForm,
}: {
  parsed: Parsed;
  nodes: AstNode[];
  family: Family;
  close: CloseRequest;
  ownedForm: boolean;
}): FooterModel {
  const model: FooterModel = { utility: [], childForm: false };
  const others: ButtonSpec[] = [];
  for (const { element, wrapped } of footerUses({ parsed, nodes, family })) {
    const spec = buttonSpec({ parsed, element });
    if (isCancel({ spec, wrapped, family }))
      takeCancel({ parsed, model, spec, wrapped, family, close });
    else others.push(spec);
  }
  if (others.length > 2) skip("footer has more than two actions");
  const primary = others.at(-1);
  const secondary = others.length === 2 ? others[0] : undefined;
  if (primary) {
    const made = describe({ parsed, spec: primary, role: "primary", ownedForm });
    Object.assign(model, { primary: made.code, primarySpec: primary });
    model.childForm ||= made.childForm;
  }
  if (secondary) {
    const made = describe({ parsed, spec: secondary, role: "secondary", ownedForm });
    model.secondary = made.code;
    model.childForm ||= made.childForm;
  }
  return model;
}

const ACTIONS_ATTRS = ["primary", "onCancel", "cancelLabel", "busy", "start", "secondary"];

/** `<Drawer.Actions primary start secondary busy onCancel>` read as a footer. */
export function readActions({
  parsed,
  element,
  close,
  ownedForm,
}: {
  parsed: Parsed;
  element: AstNode;
  close: CloseRequest;
  ownedForm: boolean;
}): FooterModel {
  const attrs = attrsOf({ opening: child(element, "openingElement") });
  onlyAttrs({ attrs, allowed: ACTIONS_ATTRS, where: "Drawer.Actions prop" });
  const model: FooterModel = { utility: [], childForm: false };
  const buttonIn = (name: string, role: Role) => {
    const attr = attrNamed({ attrs, name });
    if (!attr) return undefined;
    if (attr.value?.type !== "JSXElement") return skip(`\`${name}\` is not one Button`);
    const spec = buttonSpec({ parsed, element: attr.value });
    const effective = role === "destructive" && spec.palette !== "red" ? "utility" : role;
    const made = describe({ parsed, spec, role: effective, ownedForm });
    model.childForm ||= made.childForm;
    return { code: made.code, role: effective };
  };
  model.primary = buttonIn("primary", "primary")?.code;
  model.secondary = buttonIn("secondary", "secondary")?.code;
  const start = buttonIn("start", "destructive");
  if (start?.role === "destructive") model.destructive = start.code;
  else if (start) model.utility.push(start.code);
  if (!model.secondary) {
    const cancel = attrNamed({ attrs, name: "onCancel" });
    const label = attrNamed({ attrs, name: "cancelLabel" });
    const onClick = cancel?.value ? handlerCode({ parsed, node: cancel.value }) : close.code;
    model.cancel = label ? { label: valueCode({ parsed, attr: label }), onClick } : { onClick };
  }
  const busy = attrNamed({ attrs, name: "busy" });
  if (busy) model.busy = valueCode({ parsed, attr: busy });
  return model;
}

function cancelCode({ cancel }: { cancel: NonNullable<FooterModel["cancel"]> }): string {
  const fields = [cancel.label && `label: ${cancel.label}`, `onClick: ${cancel.onClick}`];
  return `{ ${fields.filter((field) => typeof field === "string").join(", ")} }`;
}

export function footerCode({ footer }: { footer: FooterModel }): string | undefined {
  const fields = [
    footer.primary && `primaryAction: ${footer.primary}`,
    footer.secondary && `secondaryAction: ${footer.secondary}`,
    footer.destructive && `destructiveAction: ${footer.destructive}`,
    footer.utility.length && `utilityActions: [${footer.utility.join(", ")}]`,
    footer.cancel?.onClick && `cancel: ${cancelCode({ cancel: footer.cancel })}`,
  ].filter((field) => typeof field === "string");
  return fields.length ? `{ ${fields.join(", ")} }` : undefined;
}

/** What one Root becomes, and what the file needs to say about the rest. */
export function convertFile({
  file,
  source,
  family,
  convert,
  extra,
  addEdits,
}: {
  file: string;
  source: string;
  family: Family;
  convert: ({ parsed, root }: { parsed: Parsed; root: AstNode }) => {
    text: string;
    extra?: Edit[];
  };
  extra?: ({ parsed }: { parsed: Parsed }) => string[];
  addEdits?: ({ parsed }: { parsed: Parsed }) => Edit[];
}): FileOutcome {
  const parsed = parse({ file, source });
  const outcome: FileOutcome = { edits: [], changes: [], skips: [] };
  const edits: Edit[] = [];
  for (const root of rootsOf({ parsed, family })) {
    const line = parsed.lineOf({ offset: root.start });
    const snippet = parsed.snippetOf({ node: child(root, "openingElement") ?? root });
    try {
      if (ownedElsewhere({ file })) skip("owned elsewhere or a special overlay host");
      const made = convert({ parsed, root });
      edits.push({ start: root.start, end: root.end, text: made.text }, ...(made.extra ?? []));
      const after = made.text.replace(/\s+/g, " ").slice(0, 140);
      outcome.changes.push({ line, before: snippet, after });
    } catch (error) {
      if (!(error instanceof Skipped)) throw error;
      outcome.skips.push({ line, snippet, reason: error.message });
    }
  }
  if (!edits.length) return outcome;
  const after = applyEdits({
    source,
    edits: [...edits, ...(addEdits ? addEdits({ parsed }) : [])],
  });
  const names = extra ? extra({ parsed }) : [...parsed.bindings.keys()];
  const pruned = pruneImports({ file, before: source, after, names });
  outcome.edits.push({ start: 0, end: source.length, text: pruned });
  return outcome;
}

/** The attribute and the whitespace before it, so the line closes up. */
export function attrEdit({ parsed, attr }: { parsed: Parsed; attr: Attr }): Edit {
  let start = attr.node.start;
  while (/\s/.test(parsed.source[start - 1] ?? "")) start -= 1;
  return { start, end: attr.node.end, text: "" };
}

/** The named attribute, or nothing: a spread on the element is recorded as a skip. */
export function safeAttr({
  parsed,
  outcome,
  opening,
  name,
}: {
  parsed: Parsed;
  outcome: FileOutcome;
  opening: AstNode | undefined;
  name: string;
}): Attr | undefined {
  try {
    return attrNamed({ attrs: attrsOf({ opening }), name });
  } catch (error) {
    if (!(error instanceof Skipped) || !opening) throw error;
    const line = parsed.lineOf({ offset: opening.start });
    outcome.skips.push({
      line,
      snippet: parsed.snippetOf({ node: opening }),
      reason: error.message,
    });
    return undefined;
  }
}

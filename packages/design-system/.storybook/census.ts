/**
 * The shape census: per family (tables, cards, drawers...), the sites using the design
 * system, those restyling it, the hand-built look-alikes and the distinct restyles. Read
 * from the AST of every browser source, so a prop on its own line counts like one inline.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseSync } from "oxc-parser";

import { isBrowserColourSource } from "./raw-colours.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

export const FAMILIES = [
  "tables",
  "cards",
  "pages",
  "pageHeaders",
  "listPages",
  "pagination",
  "drawers",
  "dialogs",
  "emptyStates",
  "tabs",
] as const;
export type Family = (typeof FAMILIES)[number];

export type CensusSite = {
  family: Family;
  kind: "ds" | "lookalike";
  /** `Drawer.Content`, `card-box`, `page-title Heading`... */
  what: string;
  /** The design-system element is the family's site, not one of its parts. */
  site: boolean;
  file: string;
  line: number;
  /** Override props on a design-system element; the drawn look on a look-alike. */
  props: Record<string, string>;
};
export type LiteralSite = { kind: "pixelSpacing" | "fontSize"; file: string; line: number };

export type Cluster = { signature: string; count: number; examples: string[] };
export type FamilyCensus = {
  ds: number;
  overridden: number;
  lookalike: number;
  variants: number;
  overriddenProps: Record<string, number>;
  lookalikeKinds: Record<string, number>;
  distinctValues: Record<string, number>;
  clusters: Cluster[];
};
export type FileScore = {
  file: string;
  score: number;
  ds: number;
  overridden: number;
  lookalike: number;
  literal: number;
};
export type Census = {
  families: Record<Family, FamilyCensus>;
  literals: { pixelSpacing: number; fontSize: number };
  worstFiles: FileScore[];
  modules: Record<
    string,
    Omit<FileScore, "file"> & { files: number; families: Record<string, number> }
  >;
};

type AstNode = { type: string; start: number; end: number; [key: string]: unknown };
type Binding = { source: string; imported: string };

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"
  );
}
const child = (node: AstNode, key: string): AstNode | undefined => {
  const value = node[key];
  return isNode(value) ? value : undefined;
};
const children = (node: AstNode, key: string): AstNode[] => {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
};
const text = (node: AstNode | undefined, key: string): string | undefined => {
  const value = node?.[key];
  return typeof value === "string" ? value : undefined;
};

const ALIASES: Record<string, string> = {
  p: "padding",
  px: "paddingX",
  py: "paddingY",
  pt: "paddingTop",
  pb: "paddingBottom",
  pl: "paddingLeft",
  pr: "paddingRight",
  ps: "paddingStart",
  pe: "paddingEnd",
  paddingInline: "paddingX",
  paddingBlock: "paddingY",
  m: "margin",
  mx: "marginX",
  my: "marginY",
  mt: "marginTop",
  mb: "marginBottom",
  ml: "marginLeft",
  mr: "marginRight",
  ms: "marginStart",
  me: "marginEnd",
  marginInline: "marginX",
  marginBlock: "marginY",
  w: "width",
  minW: "minWidth",
  maxW: "maxWidth",
  h: "height",
  minH: "minHeight",
  maxH: "maxHeight",
  rounded: "borderRadius",
  bgColor: "bg",
  background: "bg",
  backgroundColor: "bg",
  shadow: "boxShadow",
  templateColumns: "gridTemplateColumns",
};
const canonical = (prop: string) => ALIASES[prop] ?? prop;

const SPACING = /^(padding|margin|gap$|rowGap$|columnGap$)/;
const LOOK = /^(padding|bg$|border|boxShadow$)/;
const SIZING_PROPS = new Set(["width", "minWidth", "maxWidth", "size"]);

/** The props that restyle a design-system element; width and size only on overlay content. */
function isOverride({ prop, sizing }: { prop: string; sizing: boolean }): boolean {
  if (sizing && SIZING_PROPS.has(prop)) return true;
  return (
    SPACING.test(prop) ||
    /^(bg|boxShadow|fontSize|height|minHeight|maxHeight|style|css)$/.test(prop) ||
    /^border([A-Z]\w*)?$/.test(prop)
  );
}

const isDsSource = (source: string) => source.startsWith("@langwatch/design-system");
const isChakraSource = (source: string) =>
  source === "@chakra-ui/react" || source === "@langwatch/design-system/primitives";
const isLocalSource = (source: string) => /^(\.|~\/|@\/)/.test(source);

type Shape = { family: Family; site: boolean };
const NAMED_SITES: Record<string, Family> = {
  ListTable: "tables",
  SettingsCard: "cards",
  OverviewCard: "cards",
  WorkflowCardBase: "cards",
  WorkflowCardDisplay: "cards",
  StatTile: "cards",
  BrandedCard: "cards",
  ListPage: "listPages",
  Pagination: "pagination",
  ConfirmDialog: "dialogs",
  DeleteConfirmationDialog: "dialogs",
  NoDataInfoBlock: "emptyStates",
  ChartEmptyState: "emptyStates",
};
const PAGE_LAYOUT: Record<string, Shape> = {
  Header: { family: "pageHeaders", site: true },
  Heading: { family: "pageHeaders", site: false },
  Subtitle: { family: "pageHeaders", site: false },
  HeaderButton: { family: "pageHeaders", site: false },
  Container: { family: "pages", site: true },
  Content: { family: "pages", site: false },
  Tabs: { family: "tabs", site: true },
  TabMenu: { family: "tabs", site: true },
};
const NAMESPACES: Record<string, Family> = {
  Card: "cards",
  Drawer: "drawers",
  Dialog: "dialogs",
  EmptyState: "emptyStates",
  Tabs: "tabs",
};

/** Which family a design-system element belongs to, and whether it is the site or a part. */
function dsShape({ ref }: { ref: string }): Shape | undefined {
  const [head = "", member] = ref.split(".");
  const named = NAMED_SITES[head];
  if (named) return { family: named, site: member === undefined };
  if (head === "PageLayout") return member ? PAGE_LAYOUT[member] : undefined;
  const namespace = NAMESPACES[head];
  if (namespace && member) return { family: namespace, site: member === "Root" };
  const flat = /^(Drawer|Dialog)(\w+)$/.exec(head);
  if (flat?.[1] && !member) {
    return { family: flat[1] === "Drawer" ? "drawers" : "dialogs", site: flat[2] === "Root" };
  }
  return undefined;
}

const LOCAL_COPIES: Record<string, Family> = {
  ...NAMED_SITES,
  Drawer: "drawers",
  Dialog: "dialogs",
  EmptyState: "emptyStates",
  PageLayout: "pageHeaders",
  Card: "cards",
  Tabs: "tabs",
};
const RAW_EXPORTS: Record<string, Family> = {
  RawDrawer: "drawers",
  RawDialog: "dialogs",
  RawPagination: "pagination",
};
const LAYOUT = new Set([
  "Box",
  "Flex",
  "Stack",
  "HStack",
  "VStack",
  "Grid",
  "GridItem",
  "SimpleGrid",
  "Center",
  "Container",
  "Wrap",
]);
const CARD_BG = /^bg\.(panel|card)$/;
const PILL_RADIUS = /^(full|50%|9999(px)?|none|0)$/;
const TITLE_SIZE = /^(lg|xl|[2-6]xl)$/;
const TITLE_STYLE = /^(pageTitle|xl|[2-6]xl)$/;
const EMPTY_TEXT = /^(no|nothing)\b.*\b(yet|found|to show|here)\b/i;
const PIXELS = /\d(px)\b/;
const LITERAL_FONT = /^[\d.]+(px|rem|em|pt|%)?$/;

type Frame = {
  ref: string;
  ds: boolean;
  footer?: number;
  actions?: boolean;
  danger?: number;
};
type Props = Map<string, AstNode | undefined>;
type Scan = {
  file: string;
  source: string;
  lineStarts: number[];
  bindings: Map<string, Binding>;
  sites: CensusSite[];
  literals: LiteralSite[];
  stack: Frame[];
  mapDepth: number;
  styleDepth: number;
  headerLine?: number;
  tableSeen: boolean;
  listPageSeen: boolean;
  previousLine?: number;
  nextSeen: boolean;
};

function lineOf({ scan, offset }: { scan: Scan; offset: number }): number {
  let low = 0;
  let high = scan.lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((scan.lineStarts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function importBindings({ program }: { program: AstNode }): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  const imports = children(program, "body").filter((node) => node.type === "ImportDeclaration");
  for (const statement of imports) {
    const source = text(child(statement, "source"), "value") ?? "";
    for (const specifier of children(statement, "specifiers")) {
      const local = text(child(specifier, "local"), "name");
      if (!local) continue;
      const imported = child(specifier, "imported");
      const name = text(imported, "name") ?? text(imported, "value") ?? local;
      bindings.set(local, { source, imported: name });
    }
  }
  return bindings;
}

const unwrap = (node: AstNode | undefined) =>
  node?.type === "JSXExpressionContainer" ? child(node, "expression") : node;

/** A literal attribute value as written: `"md"` and `{4}` read `md` and `4`. */
function literalText(node: AstNode | undefined): string | undefined {
  const inner = unwrap(node);
  if (inner?.type !== "Literal") return undefined;
  const { value } = inner;
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

/** An attribute value for a signature: the literal, else the expression's source. */
function valueOf({ scan, node }: { scan: Scan; node: AstNode | undefined }): string {
  if (!node) return "true";
  const literal = literalText(node);
  if (literal !== undefined) return literal;
  const inner = unwrap(node);
  if (!inner) return "";
  return scan.source.slice(inner.start, inner.end).replace(/\s+/g, " ").slice(0, 48);
}

function checkLiteral({
  scan,
  prop,
  value,
  line,
}: {
  scan: Scan;
  prop: string;
  value: unknown;
  line: number;
}) {
  const spacing = SPACING.test(prop);
  const pixels = typeof value === "string" && PIXELS.test(value);
  const styleNumber = typeof value === "number" && value !== 0 && scan.styleDepth > 0;
  if (spacing && (pixels || styleNumber)) {
    scan.literals.push({ kind: "pixelSpacing", file: scan.file, line });
    return;
  }
  if (prop !== "fontSize") return;
  const literalFont = typeof value === "string" && LITERAL_FONT.test(value);
  if (typeof value === "number" || literalFont) {
    scan.literals.push({ kind: "fontSize", file: scan.file, line });
  }
}

function resolve({ scan, name }: { scan: Scan; name: AstNode | undefined }) {
  const members: string[] = [];
  let cursor = name;
  while (cursor?.type === "JSXMemberExpression") {
    members.unshift(text(child(cursor, "property"), "name") ?? "");
    cursor = child(cursor, "object");
  }
  const local = text(cursor, "name");
  if (!local) return undefined;
  const binding = scan.bindings.get(local);
  return { ref: [binding?.imported ?? local, ...members].join("."), binding };
}

function propsOf({ opening }: { opening: AstNode }): Props {
  const props: Props = new Map();
  for (const attribute of children(opening, "attributes")) {
    const raw = text(child(attribute, "name"), "name");
    if (raw) props.set(canonical(raw), child(attribute, "value"));
  }
  return props;
}

const textOf = (element: AstNode) =>
  children(element, "children")
    .filter((node) => node.type === "JSXText")
    .map((node) => text(node, "value") ?? "")
    .join(" ")
    .trim();

const nearest = ({ scan, pattern }: { scan: Scan; pattern: RegExp }) =>
  scan.stack.findLast((frame) => frame.ds && pattern.test(frame.ref));

type Visit = {
  scan: Scan;
  element: AstNode;
  ref: string;
  head: string;
  binding?: Binding;
  ds: boolean;
  chakra: boolean;
  line: number;
  props: Props;
};

function record({
  visit,
  ...site
}: Omit<CensusSite, "file" | "kind" | "line" | "props" | "site"> & {
  visit: Visit;
  kind?: CensusSite["kind"];
  line?: number;
  props?: Record<string, string>;
  site?: boolean;
}) {
  visit.scan.sites.push({
    kind: "lookalike",
    site: true,
    line: visit.line,
    props: {},
    ...site,
    file: visit.scan.file,
  });
}

/** A design-system component or part: the site, its override props, the Root size. */
function recordShape({ visit }: { visit: Visit }) {
  const { ref, ds, chakra, props, scan } = visit;
  const shape = chakra ? chakraShape({ ref }) : undefined;
  const found = shape ?? (ds ? dsShape({ ref }) : undefined);
  if (!found) return;
  const sizing = /^(Drawer|Dialog)\.?Content$/.test(ref);
  const overrides: Record<string, string> = {};
  for (const [prop, value] of props) {
    if (isOverride({ prop, sizing })) overrides[prop] = valueOf({ scan, node: value });
  }
  if (/^(Drawer|Dialog)\.?Root$/.test(ref) && props.has("size")) {
    overrides["Root.size"] = valueOf({ scan, node: props.get("size") });
  }
  record({ visit, ...found, kind: "ds", what: ref, props: overrides });
  if (found.family === "pageHeaders" && found.site) scan.headerLine ??= visit.line;
  if (found.family === "tables") scan.tableSeen = true;
  if (found.family === "listPages") scan.listPageSeen = true;
}

/** `RawDrawer` and friends, and a module's own `Drawer`, `ConfirmDialog`, `Pagination`... */
function recordCopies({ visit }: { visit: Visit }) {
  const { binding, head, ref } = visit;
  const raw = visit.ds ? RAW_EXPORTS[head] : undefined;
  if (raw) record({ visit, family: raw, what: `${head} (raw Chakra part)` });
  if (!binding || !isLocalSource(binding.source)) return;
  const family = LOCAL_COPIES[binding.imported];
  const member = ref.split(".")[1];
  if (family && (member === undefined || member === "Root")) {
    record({ visit, family, what: `local ${binding.imported}` });
  }
}

function recordRoles({ visit }: { visit: Visit }) {
  const { ref, scan, chakra } = visit;
  if (chakra && ref === "Table.Root" && !nearest({ scan, pattern: /^ListTable$/ })) {
    scan.tableSeen = true;
    record({ visit, family: "tables", what: "Table.Root outside ListTable" });
  }
  const role = literalText(visit.props.get("role"));
  if (!role || visit.head.startsWith("Table")) return;
  if (/^(table|row|grid|rowgroup)$/.test(role)) {
    record({ visit, family: "tables", what: `role="${role}" div table` });
  } else if (/^(tab|tablist)$/.test(role)) {
    record({ visit, family: "tabs", what: `role="${role}" hand tabs` });
  }
}

/** A layout primitive drawing a card (border or panel fill, and a radius) or a table row. */
function recordLayout({ visit }: { visit: Visit }) {
  const { ref } = visit;
  const layout = (visit.chakra && LAYOUT.has(ref)) || /^chakra\.(div|section|article)$/.test(ref);
  if (!layout) return;
  recordCardBox({ visit });
  recordGridRow({ visit });
}

function recordCardBox({ visit }: { visit: Visit }) {
  const { props, scan } = visit;
  const look: Record<string, string> = {};
  for (const [prop, value] of props) {
    if (LOOK.test(prop)) look[prop] = valueOf({ scan, node: value });
  }
  const rounded = look.borderRadius !== undefined && !PILL_RADIUS.test(look.borderRadius);
  const bordered = look.border !== undefined || look.borderWidth !== undefined;
  const panel = CARD_BG.test(look.bg ?? "");
  const exempt = literalText(props.get("role")) === "alert" || props.has("boxSize");
  if (rounded && (bordered || panel) && !exempt) {
    record({ visit, family: "cards", what: "card-box", props: look });
  }
}

function recordGridRow({ visit }: { visit: Visit }) {
  const { ref, props, scan } = visit;
  if (scan.mapDepth === 0 || !props.has("gridTemplateColumns")) return;
  const columns = valueOf({ scan, node: props.get("gridTemplateColumns") });
  const grid =
    ref === "Grid" || ref === "SimpleGrid" || literalText(props.get("display")) === "grid";
  if (grid && !/auto-(fill|fit)/.test(columns)) {
    record({
      visit,
      family: "tables",
      what: "div-grid table row",
      props: { gridTemplateColumns: columns },
    });
  }
}

function recordHeading({ visit }: { visit: Visit }) {
  const { scan, props } = visit;
  if (!visit.chakra || visit.ref !== "Heading") return;
  if (nearest({ scan, pattern: /^(PageLayout\.Header|ListPage)$/ })) return;
  if (nearest({ scan, pattern: /^(Drawer\.Header|DrawerHeader)$/ })) {
    record({ visit, family: "drawers", what: "Heading in Drawer.Header", site: false });
    return;
  }
  const title =
    literalText(props.get("as")) === "h1" ||
    TITLE_SIZE.test(literalText(props.get("size")) ?? "") ||
    TITLE_STYLE.test(literalText(props.get("textStyle")) ?? "");
  if (!title) return;
  scan.headerLine ??= visit.line;
  record({ visit, family: "pageHeaders", what: "page-title Heading" });
}

/** Marks what a drawer or dialog holds, judged when it closes (see `closeFrame`). */
function trackParts({ visit }: { visit: Visit }) {
  const { scan, ref, props } = visit;
  const drawer = visit.ds ? nearest({ scan, pattern: /^(Drawer\.Root|DrawerRoot)$/ }) : undefined;
  if (drawer && /^(Drawer\.Footer|DrawerFooter)$/.test(ref)) drawer.footer ??= visit.line;
  if (drawer && /^(Drawer\.Actions|DrawerActions)$/.test(ref)) drawer.actions = true;
  if (!/^(Button|IconButton)$/.test(visit.head)) return;
  const label = literalText(props.get("aria-label")) ?? textOf(visit.element);
  const danger =
    literalText(props.get("colorPalette")) === "red" || /^(delete|remove|revoke)\b/i.test(label);
  const dialog = danger ? nearest({ scan, pattern: /^(Dialog\.Root|DialogRoot)$/ }) : undefined;
  if (dialog) dialog.danger ??= visit.line;
  if (/^(prev|previous)( page)?$/i.test(label)) scan.previousLine ??= visit.line;
  if (/^next( page)?$/i.test(label)) scan.nextSeen = true;
}

function recordEmptyText({ visit }: { visit: Visit }) {
  if (!EMPTY_TEXT.test(textOf(visit.element))) return;
  const pattern = /^(NoDataInfoBlock|ChartEmptyState|EmptyState\.)/;
  if (nearest({ scan: visit.scan, pattern })) return;
  record({ visit, family: "emptyStates", what: "hand empty-state text" });
}

function visitElement({ scan, element }: { scan: Scan; element: AstNode }): Frame | undefined {
  const opening = child(element, "openingElement");
  const resolved = opening ? resolve({ scan, name: child(opening, "name") }) : undefined;
  if (!opening || !resolved) return undefined;
  const { ref, binding } = resolved;
  const chakra = binding !== undefined && isChakraSource(binding.source);
  const visit: Visit = {
    scan,
    element,
    ref,
    head: ref.split(".")[0] ?? "",
    binding,
    ds: binding !== undefined && isDsSource(binding.source) && !chakra,
    chakra,
    line: lineOf({ scan, offset: opening.start }),
    props: propsOf({ opening }),
  };
  recordShape({ visit });
  recordCopies({ visit });
  recordRoles({ visit });
  recordLayout({ visit });
  recordHeading({ visit });
  trackParts({ visit });
  recordEmptyText({ visit });
  return { ref, ds: visit.ds || chakra };
}

function closeFrame({ scan, frame }: { scan: Scan; frame: Frame }) {
  const push = (site: Omit<CensusSite, "file" | "kind" | "site" | "props">) =>
    scan.sites.push({ ...site, kind: "lookalike", site: false, props: {}, file: scan.file });
  const drawer = /^(Drawer\.Root|DrawerRoot)$/.test(frame.ref);
  if (drawer && frame.footer && !frame.actions) {
    push({ family: "drawers", what: "Drawer.Footer, not Drawer.Actions", line: frame.footer });
  }
  if (/^(Dialog\.Root|DialogRoot)$/.test(frame.ref) && frame.danger) {
    push({ family: "dialogs", what: "hand-built confirm Dialog", line: frame.danger });
  }
}

function walkAttribute({ scan, node }: { scan: Scan; node: AstNode }) {
  const raw = text(child(node, "name"), "name") ?? "";
  const value = unwrap(child(node, "value"));
  const literal = value?.type === "Literal" ? value.value : undefined;
  checkLiteral({
    scan,
    prop: canonical(raw),
    value: literal,
    line: lineOf({ scan, offset: node.start }),
  });
  const style = raw === "style";
  if (style) scan.styleDepth++;
  walkChildren({ scan, node });
  if (style) scan.styleDepth--;
}

function walkProperty({ scan, node }: { scan: Scan; node: AstNode }) {
  const key = child(node, "key");
  const name = text(key, "name") ?? text(key, "value");
  const value = child(node, "value");
  if (name && value?.type === "Literal") {
    const line = lineOf({ scan, offset: node.start });
    checkLiteral({ scan, prop: canonical(name), value: value.value, line });
  }
  walkChildren({ scan, node });
}

function walk({ scan, node }: { scan: Scan; node: AstNode }) {
  if (node.type === "JSXAttribute") return walkAttribute({ scan, node });
  if (node.type === "Property") return walkProperty({ scan, node });
  if (node.type === "JSXElement") {
    const frame = visitElement({ scan, element: node });
    if (frame) scan.stack.push(frame);
    walkChildren({ scan, node });
    if (frame) closeFrame({ scan, frame: scan.stack.pop() ?? frame });
    return;
  }
  const callee = node.type === "CallExpression" ? child(node, "callee") : undefined;
  const mapping = callee !== undefined && text(child(callee, "property"), "name") === "map";
  if (mapping) scan.mapDepth++;
  walkChildren({ scan, node });
  if (mapping) scan.mapDepth--;
}

function walkChildren({ scan, node }: { scan: Scan; node: AstNode }) {
  for (const value of Object.values(node)) {
    if (isNode(value)) walk({ scan, node: value });
    if (!Array.isArray(value)) continue;
    for (const item of value) if (isNode(item)) walk({ scan, node: item });
  }
}

/** File-level look-alikes: hand Prev/Next paging, and a list page built from parts. */
function finishFile({ scan }: { scan: Scan }) {
  const push = (site: Omit<CensusSite, "file" | "kind" | "site" | "props">) =>
    scan.sites.push({ ...site, kind: "lookalike", site: true, props: {}, file: scan.file });
  const paging = /\b(page|offset|cursor)/i.test(scan.source);
  if (scan.previousLine !== undefined && scan.nextSeen && paging) {
    push({ family: "pagination", what: "hand Prev/Next buttons", line: scan.previousLine });
  }
  if (scan.headerLine !== undefined && scan.tableSeen && !scan.listPageSeen) {
    push({ family: "listPages", what: "header + table, not ListPage", line: scan.headerLine });
  }
}

/** Each site in one source file: design-system uses, look-alikes, literal spacing and type. */
export function censusSites({ file, source }: { file: string; source: string }): {
  sites: CensusSite[];
  literals: LiteralSite[];
} {
  const { program, errors } = parseSync(file, source, {
    lang: file.endsWith(".tsx") ? "tsx" : "ts",
  });
  if (errors.length) throw new Error(`Cannot take the census of ${file}: ${errors[0]?.message}`);
  const lineStarts = [0];
  for (const match of source.matchAll(/\n/g)) lineStarts.push(match.index + 1);
  const root = isNode(program) ? program : undefined;
  if (!root) return { sites: [], literals: [] };
  const scan: Scan = {
    file,
    source,
    lineStarts,
    bindings: importBindings({ program: root }),
    sites: [],
    literals: [],
    stack: [],
    mapDepth: 0,
    styleDepth: 0,
    tableSeen: false,
    listPageSeen: false,
    nextSeen: false,
  };
  walk({ scan, node: root });
  finishFile({ scan });
  return { sites: scan.sites, literals: scan.literals };
}

/** The Chakra primitives that are themselves a family's design-system component. */
function chakraShape({ ref }: { ref: string }): Shape | undefined {
  const [head = "", member] = ref.split(".");
  if (!member || !["Card", "EmptyState", "Tabs"].includes(head)) return undefined;
  return { family: NAMESPACES[head] ?? "cards", site: member === "Root" };
}

const signatureOf = (site: CensusSite) => {
  const props = Object.entries(site.props)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([prop, value]) => `${prop}=${value}`);
  return `${site.what} {${props.join(", ")}}`;
};
const bump = (counts: Record<string, number>, key: string, by = 1) => {
  counts[key] = (counts[key] ?? 0) + by;
};

/** `modules/trace/browser/src/x.tsx` -> `modules/trace`; `apps/ui/src/x.tsx` -> `apps/ui`. */
export function moduleOf({ file }: { file: string }): string {
  const parts = file.split("/");
  return parts.slice(0, parts[0] === "enterprise" ? 3 : 2).join("/");
}

/** One family's totals, the props it is restyled with and its most common shapes. */
function familyCensus({ family, sites }: { family: Family; sites: CensusSite[] }): FamilyCensus {
  const own = sites.filter((site) => site.family === family);
  const overridden = own.filter(
    (site) => site.kind === "ds" && Object.keys(site.props).some((prop) => prop !== "Root.size"),
  );
  const lookalikes = own.filter((site) => site.kind === "lookalike");
  const overriddenProps: Record<string, number> = {};
  const values = new Map<string, Set<string>>();
  for (const site of own.filter((s) => s.kind === "ds")) {
    for (const [prop, value] of Object.entries(site.props)) {
      if (prop !== "Root.size") bump(overriddenProps, prop);
      values.set(prop, (values.get(prop) ?? new Set()).add(value));
    }
  }
  const lookalikeKinds: Record<string, number> = {};
  for (const site of lookalikes) bump(lookalikeKinds, site.what);
  const groups = new Map<string, CensusSite[]>();
  for (const site of [...overridden, ...lookalikes]) {
    const signature = signatureOf(site);
    groups.set(signature, [...(groups.get(signature) ?? []), site]);
  }
  const clusters = [...groups]
    .toSorted((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([signature, members]) => ({
      signature,
      count: members.length,
      examples: members.slice(0, 2).map((site) => `${site.file}:${site.line}`),
    }));
  return {
    ds: own.filter((site) => site.kind === "ds" && site.site).length,
    overridden: overridden.length,
    lookalike: lookalikes.length,
    variants: new Set(overridden.map(signatureOf)).size,
    overriddenProps: Object.fromEntries(
      Object.entries(overriddenProps).toSorted((a, b) => b[1] - a[1]),
    ),
    lookalikeKinds,
    distinctValues: Object.fromEntries(
      [...values].map(([prop, set]) => [prop, set.size] as const).toSorted((a, b) => b[1] - a[1]),
    ),
    clusters,
  };
}

/** Totals, variants and rankings from the sites of every file. */
export function summariseCensus({
  sites,
  literals,
}: {
  sites: CensusSite[];
  literals: LiteralSite[];
}): Census {
  const of = (family: Family) => familyCensus({ family, sites });
  const families: Record<Family, FamilyCensus> = {
    tables: of("tables"),
    cards: of("cards"),
    pages: of("pages"),
    pageHeaders: of("pageHeaders"),
    listPages: of("listPages"),
    pagination: of("pagination"),
    drawers: of("drawers"),
    dialogs: of("dialogs"),
    emptyStates: of("emptyStates"),
    tabs: of("tabs"),
  };

  const perFile = new Map<string, FileScore>();
  const scoreOf = (file: string) => {
    const score = perFile.get(file) ?? {
      file,
      score: 0,
      ds: 0,
      overridden: 0,
      lookalike: 0,
      literal: 0,
    };
    perFile.set(file, score);
    return score;
  };
  const moduleFamilies = new Map<string, Record<string, number>>();
  for (const site of sites) {
    const score = scoreOf(site.file);
    const drift =
      site.kind === "lookalike" || Object.keys(site.props).some((prop) => prop !== "Root.size");
    if (site.kind === "ds" && site.site) score.ds++;
    if (site.kind === "lookalike") score.lookalike++;
    else if (drift) score.overridden++;
    if (drift) {
      score.score++;
      const counts = moduleFamilies.get(moduleOf({ file: site.file })) ?? {};
      bump(counts, site.family);
      moduleFamilies.set(moduleOf({ file: site.file }), counts);
    }
  }
  for (const literal of literals) {
    const score = scoreOf(literal.file);
    score.literal++;
    score.score++;
  }
  const scores = [...perFile.values()];
  const modules: Census["modules"] = {};
  for (const score of scores) {
    const name = moduleOf({ file: score.file });
    const total = modules[name] ?? {
      files: 0,
      score: 0,
      ds: 0,
      overridden: 0,
      lookalike: 0,
      literal: 0,
      families: {},
    };
    total.files++;
    total.score += score.score;
    total.ds += score.ds;
    total.overridden += score.overridden;
    total.lookalike += score.lookalike;
    total.literal += score.literal;
    total.families = moduleFamilies.get(name) ?? {};
    modules[name] = total;
  }
  return {
    families,
    literals: {
      pixelSpacing: literals.filter((literal) => literal.kind === "pixelSpacing").length,
      fontSize: literals.filter((literal) => literal.kind === "fontSize").length,
    },
    worstFiles: scores.toSorted((a, b) => b.score - a.score).slice(0, 30),
    modules: Object.fromEntries(
      Object.entries(modules).toSorted((a, b) => b[1].score - a[1].score),
    ),
  };
}

/** Every browser source the census reads: tracked and untracked, no tests or stories. */
export function browserSources(): string[] {
  const listed = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "apps/ui/src/*.ts*",
      "modules/*/browser/src/*.ts*",
      "enterprise/modules/*/browser/src/*.ts*",
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return [...new Set(listed.split("\0"))]
    .filter((file) => /\.tsx?$/.test(file) && isBrowserColourSource(file))
    .filter((file) => existsSync(path.join(ROOT, file)));
}

export function collectCensus(): { census: Census; sites: CensusSite[]; literals: LiteralSite[] } {
  const sites: CensusSite[] = [];
  const literals: LiteralSite[] = [];
  for (const file of browserSources()) {
    const found = censusSites({ file, source: readFileSync(path.join(ROOT, file), "utf8") });
    sites.push(...found.sites);
    literals.push(...found.literals);
  }
  return { census: summariseCensus({ sites, literals }), sites, literals };
}

function familySection({ family, entry }: { family: Family; entry: FamilyCensus }): string[] {
  const out = [`## ${family}`, ""];
  const tally = (counts: Record<string, number>) =>
    Object.entries(counts)
      .map(([key, count]) => `${key} ${count}`)
      .join(", ");
  if (entry.overridden) out.push(`Restyled props: ${tally(entry.overriddenProps)}.`, "");
  if (entry.overridden) out.push(`Distinct values per prop: ${tally(entry.distinctValues)}.`, "");
  if (entry.lookalike) out.push(`Look-alikes: ${tally(entry.lookalikeKinds)}.`, "");
  if (!entry.clusters.length) return out;
  out.push("| Count | Shape | Examples |", "| ---: | --- | --- |");
  for (const cluster of entry.clusters) {
    const signature = cluster.signature.replaceAll("|", "\\|");
    out.push(`| ${cluster.count} | \`${signature}\` | ${cluster.examples.join("<br>")} |`);
  }
  out.push("");
  return out;
}

function moduleRows({ census }: { census: Census }): string[] {
  return Object.entries(census.modules)
    .filter(([, total]) => total.score > 0)
    .map(([name, total]) => {
      const worst = Object.entries(total.families)
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([family, count]) => `${family} ${count}`)
        .join(", ");
      return `| ${name} | ${total.score} | ${total.ds} | ${total.overridden} | ${total.lookalike} | ${total.literal} | ${worst} |`;
    });
}

/** The ranked report rollout lanes are cut from. */
export function renderCensusMarkdown({ census }: { census: Census }): string {
  const out: string[] = ["# Design-system shape census", ""];
  out.push(
    "Counted by `node packages/design-system/.storybook/adoption.ts --report <path>` from the AST of every browser source (no tests, no stories).",
    "`Restyled` counts design-system elements (the component or one of its parts) given a style or layout prop. `Variants` counts distinct restyles.",
    "",
    "| Family | DS sites | Restyled | Look-alikes | Variants |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const family of FAMILIES) {
    const { ds, overridden, lookalike, variants } = census.families[family];
    out.push(`| ${family} | ${ds} | ${overridden} | ${lookalike} | ${variants} |`);
  }
  out.push(
    "",
    `Literal spacing and type in browser code: ${census.literals.pixelSpacing} pixel paddings, margins or gaps; ${census.literals.fontSize} literal font sizes.`,
    "",
  );
  for (const family of FAMILIES)
    out.push(...familySection({ family, entry: census.families[family] }));
  out.push(
    "## The 30 worst files",
    "",
    "| Score | File | Restyled | Look-alikes | Literals |",
    "| ---: | --- | ---: | ---: | ---: |",
  );
  for (const file of census.worstFiles) {
    out.push(
      `| ${file.score} | ${file.file} | ${file.overridden} | ${file.lookalike} | ${file.literal} |`,
    );
  }
  out.push(
    "",
    "## Per module",
    "",
    "| Module | Score | DS sites | Restyled | Look-alikes | Literals | Worst families |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
  );
  out.push(...moduleRows({ census }));
  return `${out.join("\n")}\n`;
}

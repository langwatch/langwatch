/**
 * The shape census: per family, the roots using the design system, the parts restyling it,
 * the hand-built look-alikes and the candidates a person must classify. Read from the AST
 * of every browser source. Scores prioritise work; they are not migration counts.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseSync } from "oxc-parser";

const ROOT = path.resolve(import.meta.dirname, "../../..");

function isBrowserColourSource(file: string): boolean {
  return (
    /^(apps\/ui\/src\/|(?:enterprise\/)?modules\/[^/]+\/browser\/src\/)/.test(file) &&
    /\.[cm]?[jt]sx?$/.test(file) &&
    !/(?:^|\/)(__tests__|__fixtures__)\//.test(file) &&
    !/\.(test|spec|stories|fixture)\.[cm]?[jt]sx?$/.test(file)
  );
}
const PACKAGE_JSON = path.resolve(import.meta.dirname, "../package.json");
const ESCAPES_FILE = path.resolve(import.meta.dirname, "census-escapes.json");

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

/** `violation` and `unknown` fail a wave; `candidate` needs a disposition; the rest pass. */
export type Disposition = "adopted" | "clean" | "violation" | "candidate" | "unknown";

export type CensusSite = {
  family: Family;
  kind: "ds" | "lookalike";
  /** `Drawer.Content`, `card-box`, `page-title Heading`... */
  what: string;
  /** The element is a root of its family, not one of its parts. */
  site: boolean;
  file: string;
  line: number;
  /** Override props on a design-system element; the drawn look on a look-alike. */
  props: Record<string, string>;
  /** The root this finding belongs to; parts share their owning root's id. */
  root: string;
  /** Which migration rule the finding falls under (`legacy-overlay-part`, `card-box`...). */
  rule: string;
  disposition: Disposition;
  /** Whoever owns the file when it is not this rollout (`upgrade`). */
  owner?: string;
  /** The element is the target API, whatever props it carries. */
  adopted?: boolean;
  /** The source the target API was imported from. */
  source?: string;
  /** Semantic props the shape allows (Card padding, Drawer size), apart from the restyles. */
  choices?: Record<string, string>;
  /** Found by inference, not by name; never a mandatory conversion. */
  heuristic?: boolean;
  /** For a card-box: the family it most likely belongs to. */
  destination?: string;
  /** Why the census could not classify it. */
  reason?: string;
  /** The heading's owning surface. */
  surface?: string;
  /** A use of a module's own copy of a shape, not a second hand-built root. */
  wrapper?: "caller";
};
export type LiteralSite = { kind: "pixelSpacing" | "fontSize"; file: string; line: number };

export type Cluster = { signature: string; count: number; examples: string[] };
export type FamilyCensus = {
  /** Design-system roots (legacy, target API or otherwise); kept for the workshop pages. */
  ds: number;
  overridden: number;
  lookalike: number;
  variants: number;
  /** Distinct roots of the family, wrapper callers left out. */
  roots: number;
  /** Roots with at least one violation or unknown part. */
  affectedRoots: number;
  /** Violating or unknown sites, parts and roots alike. */
  parts: number;
  /** Heuristic findings a person must classify. */
  candidates: number;
  adoptedRoots: number;
  unknown: number;
  /** Uses of a module's own copy of a design-system shape. */
  callers: number;
  cosmeticParts: number;
  geometryParts: number;
  opaqueParts: number;
  violationsByRule: Record<string, number>;
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
  owners: Record<string, { violations: number; candidates: number; unknown: number }>;
  modules: Record<
    string,
    Omit<FileScore, "file"> & { files: number; families: Record<string, number> }
  >;
};

type AstNode = { type: string; start: number; end: number; [key: string]: unknown };
type Binding = { source: string; imported: string; members: string[] };

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"
  );
}
const child = (node: AstNode | undefined, key: string): AstNode | undefined => {
  const value = node?.[key];
  return isNode(value) ? value : undefined;
};
const children = (node: AstNode | undefined, key: string): AstNode[] => {
  const value = node?.[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
};
const text = (node: AstNode | undefined, key: string): string | undefined => {
  const value = node?.[key];
  return typeof value === "string" ? value : undefined;
};

const WRAPPERS = new Set([
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "ParenthesizedExpression",
]);
function stripWrappers(node: AstNode | undefined): AstNode | undefined {
  let cursor = node;
  while (cursor && WRAPPERS.has(cursor.type)) cursor = child(cursor, "expression");
  return cursor;
}

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
const STYLE_PROPS = /^(bg|boxShadow|fontSize|height|minHeight|maxHeight|style|css)$/;
const TYPE_PROPS = /^(color|textStyle|fontWeight)$/;
const CONDITION = /^_[a-zA-Z]/;
const GEOMETRY =
  /^(padding|margin|gap$|rowGap$|columnGap$|width$|minWidth$|maxWidth$|height$|minHeight$|maxHeight$|size$)/;

/** The props that restyle a design-system element; width and size only on overlay content. */
function isOverride({ prop, sizing }: { prop: string; sizing: boolean }): boolean {
  if (sizing && SIZING_PROPS.has(prop)) return true;
  return (
    SPACING.test(prop) ||
    STYLE_PROPS.test(prop) ||
    TYPE_PROPS.test(prop) ||
    /^border([A-Z]\w*)?$/.test(prop)
  );
}

/** Whether a restyle changes how a shape looks, how much room it takes, or cannot be read. */
export function driftKind({ prop }: { prop: string }): "cosmetic" | "geometry" | "opaque" {
  const key = CONDITION.test(prop) && prop.includes(".") ? prop.slice(prop.indexOf(".") + 1) : prop;
  if (/^(style|css)$/.test(key)) return "opaque";
  return GEOMETRY.test(key) ? "geometry" : "cosmetic";
}

const isDsSource = (source: string) => source.startsWith("@langwatch/design-system");
const isChakraSource = (source: string) =>
  source === "@chakra-ui/react" || source === "@langwatch/design-system/primitives";
const isLocalSource = (source: string) => /^(\.|~\/|@\/)/.test(source);

type Role = "adopted" | "legacy" | "ds" | "unknown";
type ShapeInfo = {
  family: Family;
  site: boolean;
  role: Role;
  rule: string;
  allowed: string[];
  source?: string;
  reason?: string;
};

type TargetEntry = { family: Family; subpath?: string; allowed: string[] };
/** The target API by export; `subpath` pins the source where the shape is new. */
const TARGET: Record<string, TargetEntry> = {
  Drawer: { family: "drawers", subpath: "drawer", allowed: ["size"] },
  Dialog: { family: "dialogs", subpath: "dialog", allowed: ["size"] },
  ActionRow: { family: "drawers", subpath: "action-row", allowed: [] },
  Card: { family: "cards", subpath: "card", allowed: ["padding", "variant", "borderTone"] },
  CardGrid: { family: "cards", subpath: "card", allowed: [] },
  ResourceTile: { family: "cards", subpath: "resource-tile", allowed: [] },
  LoadMore: { family: "pagination", subpath: "load-more", allowed: [] },
  ListPage: { family: "listPages", subpath: "list-page", allowed: [] },
  Pagination: { family: "pagination", allowed: [] },
  ListTable: { family: "tables", allowed: [] },
  TableToolbar: { family: "tables", subpath: "table-toolbar", allowed: [] },
  ColumnPicker: { family: "tables", subpath: "column-picker", allowed: [] },
  SelectionActionBar: {
    family: "tables",
    subpath: "selection-action-bar",
    allowed: ["placement"],
  },
  ContentTabs: {
    family: "tabs",
    subpath: "content-tabs",
    allowed: ["density", "body", "inset", "scroll", "mount", "activationMode"],
  },
  CodeTabs: { family: "tabs", subpath: "code-tabs", allowed: [] },
  MetricTabs: {
    family: "tabs",
    subpath: "metric-tabs",
    allowed: ["mount", "activationMode"],
  },
  ConfirmDialog: { family: "dialogs", allowed: [] },
  DeleteConfirmationDialog: { family: "dialogs", allowed: [] },
  NoDataInfoBlock: { family: "emptyStates", allowed: [] },
  ChartEmptyState: { family: "emptyStates", allowed: [] },
};
const NAMED_SITES: Record<string, Family> = {
  SettingsCard: "cards",
  OverviewCard: "cards",
  WorkflowCardBase: "cards",
  WorkflowCardDisplay: "cards",
  StatTile: "cards",
  BrandedCard: "cards",
};
const PAGE_LAYOUT: Record<string, { family: Family; site: boolean }> = {
  Header: { family: "pageHeaders", site: true },
  Heading: { family: "pageHeaders", site: false },
  Subtitle: { family: "pageHeaders", site: false },
  HeaderButton: { family: "pageHeaders", site: false },
  Container: { family: "pages", site: true },
  Content: { family: "pages", site: false },
  Tabs: { family: "tabs", site: true },
  TabMenu: { family: "tabs", site: true },
};
const LEGACY: Record<string, { family: Family; rule: string }> = {
  Drawer: { family: "drawers", rule: "legacy-overlay-part" },
  Dialog: { family: "dialogs", rule: "legacy-overlay-part" },
  EmptyState: { family: "emptyStates", rule: "legacy-empty-state" },
  Card: { family: "cards", rule: "legacy-card-part" },
  Tabs: { family: "tabs", rule: "legacy-tabs-part" },
  Table: { family: "tables", rule: "legacy-table-part" },
};
const OVERLAY_PARTS = new Set([
  "Root",
  "Content",
  "Header",
  "Body",
  "Footer",
  "Title",
  "Description",
  "CloseTrigger",
  "ActionTrigger",
  "Actions",
  "Trigger",
  "Backdrop",
  "Positioner",
]);
const RAW_EXPORTS: Record<string, Family> = {
  RawDrawer: "drawers",
  RawDialog: "dialogs",
  RawPagination: "pagination",
  RawTabs: "tabs",
  RawTable: "tables",
};
/** Chakra's flat export names (`TabsRoot`, `TableRow`): the parts of the two raw families. */
const FLAT_PARTS: Record<string, { family: Family; rule: string; parts: Set<string> }> = {
  Tabs: {
    family: "tabs",
    rule: "legacy-tabs-part",
    parts: new Set(["Root", "RootProvider", "List", "Trigger", "Content", "ContentGroup"]),
  },
  Table: {
    family: "tables",
    rule: "legacy-table-part",
    parts: new Set([
      "Root",
      "Header",
      "Body",
      "Footer",
      "Row",
      "Cell",
      "ColumnHeader",
      "Column",
      "ColumnGroup",
      "Caption",
      "ScrollArea",
    ]),
  },
};
const FLAT_PART_NAME = /^(Tabs|Table)(Root(?:Provider)?|[A-Z]\w*)$/;
/** Hooks that build raw tabs by hand. */
const TABS_HOOKS = new Set(["useTabs", "useTabsContext", "useTabsStyles", "useRawTabs"]);
/** Elements that are a table by tag, native or through `as` and `chakra(...)`. */
const TABLE_TAGS = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
]);
/** Roots of a legacy family: `Tabs.RootProvider` opens tabs as `Tabs.Root` does. */
const LEGACY_ROOTS = new Set(["Root", "RootProvider"]);

const sourceMatches = ({ source, subpath }: { source: string; subpath?: string }) =>
  subpath === undefined ||
  source === "@langwatch/design-system" ||
  source === `@langwatch/design-system/${subpath}`;

const shapeInfo = (found: Pick<ShapeInfo, "family" | "site" | "role" | "rule">): ShapeInfo => ({
  ...found,
  allowed: [],
});

function targetInfo({ head, source }: { head: string; source: string }): ShapeInfo | undefined {
  const target = TARGET[head];
  if (!target) return undefined;
  const matched = sourceMatches({ source, subpath: target.subpath });
  const base = {
    ...shapeInfo({ family: target.family, site: true, role: "adopted", rule: "adopted" }),
    allowed: target.allowed,
    source,
  };
  if (matched) return base;
  const reason = `${head} imported from ${source}, not the registered subpath`;
  return { ...base, role: "unknown", rule: "unregistered-source", reason };
}

function flatShape({ head }: { head: string }): ShapeInfo | undefined {
  const match = FLAT_PART_NAME.exec(head);
  const flat = match?.[1] ? FLAT_PARTS[match[1]] : undefined;
  const part = match?.[2];
  if (!flat || !part || !flat.parts.has(part)) return undefined;
  const root = part === "Root" || part === "RootProvider";
  const rule = flat.family === "tables" && part === "Root" ? "hand-table" : flat.rule;
  return shapeInfo({ family: flat.family, site: root, role: "legacy", rule });
}

function overlayFlatShape({ head }: { head: string }): ShapeInfo | undefined {
  const flat = /^(Drawer|Dialog)(\w+)$/.exec(head);
  if (!flat?.[2] || !OVERLAY_PARTS.has(flat[2])) return undefined;
  const family = flat[1] === "Drawer" ? "drawers" : "dialogs";
  return shapeInfo({
    family,
    site: flat[2] === "Root",
    role: "legacy",
    rule: "legacy-overlay-part",
  });
}

function dottedShape({ head, member }: { head: string; member: string }): ShapeInfo | undefined {
  const old = LEGACY[head];
  if (!old) return undefined;
  return shapeInfo({
    family: old.family,
    site: LEGACY_ROOTS.has(member),
    role: "legacy",
    rule: old.family === "tables" && member === "Root" ? "hand-table" : old.rule,
  });
}

function legacyShape({
  head,
  member,
  ds,
  chakra,
}: {
  head: string;
  member?: string;
  ds: boolean;
  chakra: boolean;
}): ShapeInfo | undefined {
  const raw = ds ? RAW_EXPORTS[head] : undefined;
  if (raw) {
    return shapeInfo({
      family: raw,
      site: !member || member === "Root",
      role: "legacy",
      rule: "raw-export",
    });
  }
  if (member) return dottedShape({ head, member });
  if (!ds && !chakra) return undefined;
  return flatShape({ head }) ?? (ds ? overlayFlatShape({ head }) : undefined);
}

function plainShape({
  head,
  member,
  ds,
}: {
  head: string;
  member?: string;
  ds: boolean;
}): ShapeInfo | undefined {
  if (!ds) return undefined;
  if (head === "ListTable" && member) {
    return shapeInfo({ family: "tables", site: false, role: "adopted", rule: "adopted" });
  }
  const named = NAMED_SITES[head];
  if (named)
    return shapeInfo({ family: named, site: member === undefined, role: "ds", rule: "clean" });
  const layout = head === "PageLayout" && member ? PAGE_LAYOUT[member] : undefined;
  return layout ? shapeInfo({ ...layout, role: "ds", rule: "clean" }) : undefined;
}

/** Which family a reference belongs to, and whether it is target API, legacy part or neither. */
function classifyRef({ ref, source }: { ref: string; source: string }): ShapeInfo | undefined {
  const chakra = isChakraSource(source);
  const ds = isDsSource(source) && !chakra;
  if (!ds && !chakra) return undefined;
  const [head = "", member] = ref.split(".");
  const target = ds && member === undefined ? targetInfo({ head, source }) : undefined;
  return target ?? legacyShape({ head, member, ds, chakra }) ?? plainShape({ head, member, ds });
}

const LOCAL_COPIES: Record<string, Family> = {
  ...Object.fromEntries(Object.entries(TARGET).map(([name, { family }]) => [name, family])),
  ...NAMED_SITES,
  EmptyState: "emptyStates",
  PageLayout: "pageHeaders",
  Tabs: "tabs",
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
const NO_BORDER = /^(none|hidden|0|0px|0rem|0 .*|none .*)$/;
const TITLE_SIZE = /^(lg|xl|[2-6]xl)$/;
const TITLE_STYLE = /^(pageTitle|xl|[2-6]xl)$/;
const EMPTY_TEXT = /^(no|nothing)\b.*\b(yet|found|to show|here)\b/i;
const PIXELS = /\d(px)\b/;
const LITERAL_FONT = /^[\d.]+(px|rem|em|pt|%)?$/;
const PREVIOUS = /^(prev|previous)( page)?$/i;
const NEXT = /^next( page)?$/i;
const LOAD_LABEL = /^load\s+(more|earlier|older|next)\b/i;
const SHOW_LABEL = /^(show|view|see)\s+(earlier|older|newer|previous)\b/i;
const MORE_LABEL = /^(show|view|see)\s+more\b/i;
const FETCHES = /\b(fetchNext\w*|fetchPrevious\w*|fetchMore|loadMore\w*|nextPage)\b/;
const NOT_A_CARD = new Set(["icon-tile", "tooltip", "skeleton", "input", "expressive-exception"]);
const UPGRADE_PATH = /(^|\/)upgrades?\//;

type Hop = { line: number; hops: number };
type Frame = {
  ref: string;
  ds: boolean;
  family?: Family;
  rootId?: string;
  danger?: number;
  prev?: Hop;
  next?: Hop;
  pager?: boolean;
};
type Props = Map<string, AstNode | undefined>;
type Loc = { line: number; col: number };
type ComponentState = { headerLine?: number; table: boolean; listPage: boolean };
type Scan = {
  file: string;
  source: string;
  lineStarts: number[];
  bindings: Map<string, Binding>;
  imported: Set<string>;
  constObjects: Map<string, AstNode>;
  unknownLocals: Map<string, { family: Family; reason: string }>;
  shadow: Set<string>[];
  components: string[];
  componentState: Map<string, ComponentState>;
  attrs: { name: string; depth: number }[];
  sites: CensusSite[];
  literals: LiteralSite[];
  stack: Frame[];
  mapDepth: number;
  styleDepth: number;
};

function locOf({ scan, offset }: { scan: Scan; offset: number }): Loc {
  let low = 0;
  let high = scan.lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((scan.lineStarts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, col: offset - (scan.lineStarts[low] ?? 0) };
}
const lineOf = ({ scan, offset }: { scan: Scan; offset: number }) => locOf({ scan, offset }).line;

const SPECIAL_IMPORTS: Record<string, string> = {
  ImportNamespaceSpecifier: "*",
  ImportDefaultSpecifier: "default",
};

function importBindings({ program }: { program: AstNode }): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  const imports = children(program, "body").filter((node) => node.type === "ImportDeclaration");
  for (const statement of imports) {
    const source = text(child(statement, "source"), "value") ?? "";
    for (const specifier of children(statement, "specifiers")) {
      const local = text(child(specifier, "local"), "name");
      if (!local) continue;
      const imported = child(specifier, "imported");
      const name =
        SPECIAL_IMPORTS[specifier.type] ??
        text(imported, "name") ??
        text(imported, "value") ??
        local;
      bindings.set(local, { source, imported: name, members: [] });
    }
  }
  return bindings;
}

/** A binding reached through more members: `DS.Card` is `Card`, `Drawer.Root` adds Root. */
function extend({ base, members }: { base: Binding; members: string[] }): Binding {
  if (base.imported === "*" && members.length) {
    return { source: base.source, imported: members[0] ?? "*", members: members.slice(1) };
  }
  return { ...base, members: [...base.members, ...members] };
}

/** What an expression is when it is an alias of an imported name or a member of one. */
function aliasTarget({
  bindings,
  node,
}: {
  bindings: Map<string, Binding>;
  node: AstNode | undefined;
}): Binding | undefined {
  const members: string[] = [];
  let cursor = stripWrappers(node);
  while (cursor?.type === "MemberExpression" && cursor.computed !== true) {
    members.unshift(text(child(cursor, "property"), "name") ?? "");
    cursor = stripWrappers(child(cursor, "object"));
  }
  const local = cursor?.type === "Identifier" ? text(cursor, "name") : undefined;
  const base = local ? bindings.get(local) : undefined;
  return base ? extend({ base, members }) : undefined;
}

function familyOfBinding({ binding }: { binding: Binding }): Family | undefined {
  const ref = [binding.imported, ...binding.members].join(".");
  return classifyRef({ ref, source: binding.source })?.family;
}

function mentionedFamily({
  bindings,
  node,
}: {
  bindings: Map<string, Binding>;
  node: AstNode | undefined;
}): Family | undefined {
  if (!node) return undefined;
  const named = node.type === "Identifier" || node.type === "MemberExpression";
  const target = named ? aliasTarget({ bindings, node }) : undefined;
  return target ? familyOfBinding({ binding: target }) : nestedMention({ bindings, node });
}

function nestedMention({
  bindings,
  node,
}: {
  bindings: Map<string, Binding>;
  node: AstNode;
}): Family | undefined {
  const skip = node.type === "MemberExpression" && node.computed !== true ? "property" : "";
  for (const [key, value] of Object.entries(node)) {
    const kids = key === skip ? [] : [value].flat();
    for (const kid of kids) {
      const found = isNode(kid) ? mentionedFamily({ bindings, node: kid }) : undefined;
      if (found) return found;
    }
  }
  return undefined;
}

/** `chakra("table")`: the factory for a table tag is the site, wherever its result is used. */
function recordTableFactory({ scan, init }: { scan: Scan; init: AstNode }) {
  if (init.type !== "CallExpression") return;
  const callee = child(init, "callee");
  const local = callee?.type === "Identifier" ? text(callee, "name") : undefined;
  const binding = local ? scan.bindings.get(local) : undefined;
  if (!binding || binding.imported !== "chakra" || !isChakraSource(binding.source)) return;
  const [argument] = children(init, "arguments");
  const tag = argument?.type === "Literal" ? argument.value : undefined;
  if (typeof tag !== "string" || !TABLE_TAGS.has(tag)) return;
  const root = tag === "table";
  emit({
    scan,
    loc: locOf({ scan, offset: init.start }),
    family: "tables",
    what: `chakra("${tag}") outside ListTable`,
    site: root,
    rule: root ? "native-table" : "legacy-table-part",
    disposition: "violation",
  });
}

const MAYBE_COMPONENT = new Set(["ConditionalExpression", "LogicalExpression", "CallExpression"]);

function declareIdentifier({
  scan,
  name,
  init,
  target,
}: {
  scan: Scan;
  name: string;
  init: AstNode;
  target?: Binding;
}) {
  if (scan.imported.has(name)) return;
  recordTableFactory({ scan, init });
  if (target) scan.bindings.set(name, target);
  else if (init.type === "ObjectExpression") scan.constObjects.set(name, init);
  else if (MAYBE_COMPONENT.has(init.type)) {
    const family = mentionedFamily({ bindings: scan.bindings, node: init });
    if (family) scan.unknownLocals.set(name, { family, reason: `${name} wraps a shape` });
  }
}

function declarePattern({
  scan,
  pattern,
  target,
}: {
  scan: Scan;
  pattern: AstNode;
  target: Binding;
}) {
  for (const property of children(pattern, "properties")) {
    const key = text(child(property, "key"), "name");
    const value = child(property, "value");
    const local = text(value?.type === "AssignmentPattern" ? child(value, "left") : value, "name");
    if (key && local) scan.bindings.set(local, extend({ base: target, members: [key] }));
  }
}

function declareAlias({ scan, declarator }: { scan: Scan; declarator: AstNode }) {
  const id = child(declarator, "id");
  const init = stripWrappers(child(declarator, "init"));
  if (!id || !init) return;
  const target = aliasTarget({ bindings: scan.bindings, node: init });
  if (id.type === "Identifier") {
    declareIdentifier({ scan, name: text(id, "name") ?? "", init, ...(target ? { target } : {}) });
  } else if (id.type === "ObjectPattern" && target) declarePattern({ scan, pattern: id, target });
}

function collectAliases({ scan, node }: { scan: Scan; node: AstNode }) {
  if (node.type === "VariableDeclarator") declareAlias({ scan, declarator: node });
  for (const value of Object.values(node)) {
    if (isNode(value)) collectAliases({ scan, node: value });
    else if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) collectAliases({ scan, node: item });
    }
  }
}

function patternNames({ node, out }: { node: AstNode | undefined; out: Set<string> }) {
  if (!node) return;
  if (node.type === "Identifier") out.add(text(node, "name") ?? "");
  else if (node.type === "AssignmentPattern") patternNames({ node: child(node, "left"), out });
  else if (node.type === "RestElement") patternNames({ node: child(node, "argument"), out });
  else if (node.type === "ObjectPattern") {
    for (const property of children(node, "properties")) {
      patternNames({ node: child(property, "value") ?? child(property, "argument"), out });
    }
  } else if (node.type === "ArrayPattern") {
    for (const element of children(node, "elements")) patternNames({ node: element, out });
  }
}

/** Names a function declares (parameters and top-level locals) that hide an outer binding. */
function declaredNames({ scan, node }: { scan: Scan; node: AstNode }): Set<string> {
  const names = new Set<string>();
  for (const param of children(node, "params")) patternNames({ node: param, out: names });
  const body = child(node, "body");
  for (const statement of body?.type === "BlockStatement" ? children(body, "body") : []) {
    if (statement.type === "VariableDeclaration") {
      for (const declarator of children(statement, "declarations")) {
        patternNames({ node: child(declarator, "id"), out: names });
      }
    } else if (statement.type === "FunctionDeclaration") {
      patternNames({ node: child(statement, "id"), out: names });
    }
  }
  return new Set([...names].filter((name) => scan.imported.has(name)));
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

/** An attribute value for a signature: the literal, else the expression's full source. */
function valueOf({ scan, node }: { scan: Scan; node: AstNode | undefined }): string {
  if (!node) return "true";
  const literal = literalText(node);
  if (literal !== undefined) return literal;
  const inner = unwrap(node);
  if (!inner) return "";
  return scan.source.slice(inner.start, inner.end).replace(/\s+/g, " ");
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
  const hidden = scan.shadow.some((names) => names.has(local));
  const base = hidden ? undefined : scan.bindings.get(local);
  const binding = base ? extend({ base, members }) : undefined;
  const ref = binding
    ? [binding.imported, ...binding.members].join(".")
    : [local, ...members].join(".");
  const unknown = hidden || binding ? undefined : scan.unknownLocals.get(local);
  return { ref, binding, unknown };
}

type Resolved = { props: Props; unresolved: string[] };

function addObject({ object, into }: { object: AstNode; into: Resolved }) {
  for (const member of children(object, "properties")) {
    const key = child(member, "key");
    const name = member.computed === true ? undefined : (text(key, "name") ?? text(key, "value"));
    if (member.type === "Property" && name) into.props.set(canonical(name), child(member, "value"));
    else into.unresolved.push(member.type === "Property" ? "computed key" : "nested spread");
  }
}

/** Every attribute, with literal object spreads (inline or a const in the file) read in place. */
function propsOf({ scan, opening }: { scan: Scan; opening: AstNode }): Resolved {
  const into: Resolved = { props: new Map(), unresolved: [] };
  for (const attribute of children(opening, "attributes")) {
    if (attribute.type === "JSXSpreadAttribute") {
      const argument = stripWrappers(child(attribute, "argument"));
      const named = argument?.type === "Identifier" ? text(argument, "name") : undefined;
      const object =
        argument?.type === "ObjectExpression" ? argument : scan.constObjects.get(named ?? "");
      if (object) addObject({ object, into });
      else into.unresolved.push("spread");
      continue;
    }
    const raw = text(child(attribute, "name"), "name");
    if (raw) into.props.set(canonical(raw), child(attribute, "value"));
  }
  return into;
}

function labelOf({ element, deep }: { element: AstNode; deep: boolean }) {
  let out = "";
  let dynamic = false;
  const read = (node: AstNode) => {
    for (const kid of children(node, "children")) {
      if (kid.type === "JSXText") out += ` ${text(kid, "value") ?? ""}`;
      else if (kid.type === "JSXElement" && deep) read(kid);
      else if (kid.type === "JSXExpressionContainer") {
        const expression = child(kid, "expression");
        const literal = literalText(expression) ?? templateText(expression);
        if (literal !== undefined) out += ` ${literal}`;
        else if (expression && expression.type !== "JSXEmptyExpression") dynamic = true;
      }
    }
  };
  read(element);
  return { text: out.replace(/\s+/g, " ").trim(), dynamic };
}

function templateText(node: AstNode | undefined): string | undefined {
  if (node?.type !== "TemplateLiteral" || children(node, "expressions").length) return undefined;
  return children(node, "quasis")
    .map((quasi) => text(child(quasi, "value"), "cooked") ?? "")
    .join("");
}

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
  loc: Loc;
  line: number;
  props: Props;
  unresolved: string[];
  info?: ShapeInfo;
};

type Emit = Pick<CensusSite, "family" | "what" | "rule" | "disposition"> &
  Partial<Omit<CensusSite, "family" | "what" | "rule" | "disposition" | "file" | "line">>;

function rootFor({
  scan,
  family,
  site,
  loc,
}: {
  scan: Scan;
  family: Family;
  site: boolean;
  loc: Loc;
}): string {
  if (site) return `${scan.file}:${loc.line}:${loc.col}`;
  const frame = scan.stack.findLast((entry) => entry.family === family && entry.rootId);
  return frame?.rootId ?? `${scan.file}::${scan.components.at(-1) ?? "module"}`;
}

function emit({ scan, loc, ...fields }: { scan: Scan; loc: Loc } & Emit): CensusSite {
  const site = fields.site ?? true;
  const created: CensusSite = {
    kind: "lookalike",
    props: {},
    ...fields,
    site,
    root: fields.root ?? rootFor({ scan, family: fields.family, site, loc }),
    file: scan.file,
    line: loc.line,
  };
  scan.sites.push(created);
  return created;
}

const record = ({ visit, ...fields }: { visit: Visit } & Emit) =>
  emit({ scan: visit.scan, loc: visit.loc, ...fields });

const stateOf = ({ scan }: { scan: Scan }): ComponentState => {
  const key = scan.components.at(-1) ?? "<module>";
  const state = scan.componentState.get(key) ?? { table: false, listPage: false };
  scan.componentState.set(key, state);
  return state;
};

/** The condition objects (`_hover={{ bg }}`) read one level down, key by key. */
function conditionEntries({
  scan,
  prop,
  node,
  sink,
}: {
  scan: Scan;
  prop: string;
  node: AstNode | undefined;
  sink: { overrides: Record<string, string>; unresolved: string[] };
}) {
  const object = stripWrappers(unwrap(node));
  if (object?.type !== "ObjectExpression") {
    sink.overrides[prop] = valueOf({ scan, node });
    return;
  }
  for (const member of children(object, "properties")) {
    const key = child(member, "key");
    const name = member.computed === true ? undefined : (text(key, "name") ?? text(key, "value"));
    if (member.type !== "Property" || !name) {
      sink.unresolved.push(`${prop} spread`);
      continue;
    }
    const style = canonical(name);
    if (isOverride({ prop: style, sizing: true }) || CONDITION.test(style)) {
      sink.overrides[`${prop}.${style}`] = valueOf({ scan, node: child(member, "value") });
    }
  }
}

function overridesOf({ visit, info, sizing }: { visit: Visit; info: ShapeInfo; sizing: boolean }) {
  const sink = { overrides: {} as Record<string, string>, unresolved: [...visit.unresolved] };
  const choices: Record<string, string> = {};
  for (const [prop, node] of visit.props) {
    if (info.allowed.includes(prop)) choices[prop] = valueOf({ scan: visit.scan, node });
    else if (prop === "height" && visit.ref === "ListTable.PaddingRow") continue;
    else if (CONDITION.test(prop)) {
      conditionEntries({ scan: visit.scan, prop, node, sink });
    } else if (isOverride({ prop, sizing })) {
      sink.overrides[prop] = valueOf({ scan: visit.scan, node });
    }
  }
  if (/^(Drawer|Dialog)\.?Root$/.test(visit.ref) && visit.props.has("size")) {
    sink.overrides["Root.size"] = valueOf({ scan: visit.scan, node: visit.props.get("size") });
  }
  return { overrides: sink.overrides, unresolved: sink.unresolved, choices };
}

function judge({
  info,
  drifted,
  unresolved,
}: {
  info: ShapeInfo;
  drifted: boolean;
  unresolved: string[];
}): { disposition: Disposition; rule: string } {
  if (info.role === "legacy") return { disposition: "violation", rule: info.rule };
  if (drifted) return { disposition: "violation", rule: "restyle" };
  if (info.role === "unknown") return { disposition: "unknown", rule: info.rule };
  if (unresolved.length) return { disposition: "unknown", rule: "unresolved-props" };
  return { disposition: info.role === "adopted" ? "adopted" : "clean", rule: info.rule };
}

/** A design-system component or part: root or part, its restyles, whether it is target API. */
function recordShape({ visit }: { visit: Visit }): Pick<Frame, "family" | "rootId"> {
  const { binding, scan } = visit;
  const info = binding ? classifyRef({ ref: visit.ref, source: binding.source }) : undefined;
  if (!info) return {};
  visit.info = info;
  const wide =
    /^(Drawer|Dialog)\.?Content$/.test(visit.ref) ||
    (info.role === "adopted" && /^(Drawer|Dialog|Card|ResourceTile)$/.test(visit.head));
  const { overrides, unresolved, choices } = overridesOf({ visit, info, sizing: wide });
  const drifted = Object.keys(overrides).some((prop) => prop !== "Root.size");
  const reason = info.reason ?? (unresolved.length ? `unresolved ${unresolved.join(", ")}` : "");
  const created = record({
    visit,
    family: info.family,
    site: info.site,
    kind: "ds",
    what: visit.ref,
    props: overrides,
    ...judge({ info, drifted, unresolved }),
    adopted: info.role === "adopted",
    ...(info.source ? { source: info.source } : {}),
    ...(Object.keys(choices).length ? { choices } : {}),
    ...(reason ? { reason } : {}),
  });
  const state = stateOf({ scan });
  if (info.family === "pageHeaders" && info.site) state.headerLine ??= visit.line;
  if (info.family === "tables") state.table = true;
  if (info.family === "listPages") state.listPage = true;
  return { family: info.family, rootId: created.root };
}

/** A name that resolves to a wrapper of a shape we cannot see through. */
function recordUnknown({
  visit,
  unknown,
}: {
  visit: Visit;
  unknown?: { family: Family; reason: string };
}) {
  if (!unknown) return;
  record({
    visit,
    family: unknown.family,
    what: visit.ref,
    rule: "unresolved-wrapper",
    disposition: "unknown",
    reason: unknown.reason,
  });
}

/** A module's own `Drawer`, `ConfirmDialog`, `Pagination`...: its callers, not new roots. */
function recordCopies({ visit }: { visit: Visit }) {
  const { binding, ref } = visit;
  if (!binding || !isLocalSource(binding.source)) return;
  const family = LOCAL_COPIES[binding.imported];
  const member = ref.split(".")[1];
  if (family && (member === undefined || member === "Root")) {
    record({
      visit,
      family,
      what: `local ${binding.imported}`,
      rule: "local-copy",
      disposition: "violation",
      wrapper: "caller",
    });
  }
}

/** The table tag an element is by name, `chakra.<tag>` or `as`. */
function tableTagOf({ visit }: { visit: Visit }): string | undefined {
  const { ref, binding, chakra, ds } = visit;
  if (!binding) return TABLE_TAGS.has(ref) ? ref : undefined;
  const [name, member] = ref.split(".");
  if (chakra && name === "chakra" && member && TABLE_TAGS.has(member)) return member;
  const as = literalText(visit.props.get("as"));
  return (chakra || ds) && as !== undefined && TABLE_TAGS.has(as) ? as : undefined;
}

/** A table drawn from native tags, `as`, `chakra("table")` or ARIA roles: a hand table. */
function recordHandTables({
  visit,
}: {
  visit: Visit;
}): Pick<Frame, "family" | "rootId"> | undefined {
  const tag = tableTagOf({ visit });
  const role = literalText(visit.props.get("role"));
  if (tag) {
    stateOf({ scan: visit.scan }).table = true;
    const root = tag === "table";
    const created = record({
      visit,
      family: "tables",
      what: root ? "<table> outside ListTable" : `<${tag}> outside ListTable`,
      site: root,
      rule: root ? "native-table" : "legacy-table-part",
      disposition: "violation",
    });
    return root ? { family: "tables", rootId: created.root } : undefined;
  }
  if (!role || visit.head.startsWith("Table")) return undefined;
  if (/^(table|row|grid|rowgroup)$/.test(role)) {
    stateOf({ scan: visit.scan }).table = true;
    record({
      visit,
      family: "tables",
      what: `role="${role}" div table`,
      rule: "hand-table",
      disposition: "violation",
    });
  }
  return undefined;
}

function recordRoles({ visit }: { visit: Visit }): Pick<Frame, "family" | "rootId"> | undefined {
  const { ref, scan, chakra } = visit;
  if (chakra && ref === "Table.Root" && !visit.info) {
    stateOf({ scan }).table = true;
    record({
      visit,
      family: "tables",
      what: "Table.Root outside ListTable",
      rule: "hand-table",
      disposition: "violation",
    });
  }
  const frame = recordHandTables({ visit });
  const role = literalText(visit.props.get("role"));
  if (role && /^(tab|tablist)$/.test(role) && !visit.head.startsWith("Table")) {
    record({
      visit,
      family: "tabs",
      what: `role="${role}" hand tabs`,
      rule: "hand-tabs",
      disposition: "violation",
    });
  }
  return frame;
}

/** A layout primitive drawing a card (border or panel fill, and a radius) or a table row. */
function recordLayout({ visit }: { visit: Visit }) {
  const { ref } = visit;
  const layout = (visit.chakra && LAYOUT.has(ref)) || /^chakra\.(div|section|article)$/.test(ref);
  if (!layout) return;
  recordCardBox({ visit });
  recordGridRow({ visit });
}

/** Whether a literal border exists: `borderWidth={0}` and `border="none"` are no border. */
function borderOf({ visit }: { visit: Visit }): "yes" | "no" | "unknown" {
  const states = ["border", "borderWidth"]
    .filter((prop) => visit.props.has(prop))
    .map((prop) => {
      const literal = literalText(visit.props.get(prop));
      if (literal === undefined) return "unknown";
      return NO_BORDER.test(literal.trim()) ? "no" : "yes";
    });
  if (states.includes("yes")) return "yes";
  return states.includes("unknown") ? "unknown" : "no";
}

function destinationOf({ visit }: { visit: Visit }): string {
  const { scan, props } = visit;
  const role = literalText(props.get("role")) ?? "";
  const size = literalText(props.get("boxSize"));
  const small =
    size !== undefined &&
    (/^\d+$/.test(size) ? Number(size) <= 16 : /^\d+px$/.test(size) && parseInt(size, 10) <= 64);
  if (nearest({ scan, pattern: /^Tooltip(\.|$)/ })) return "tooltip";
  if (nearest({ scan, pattern: /^Skeleton/ })) return "skeleton";
  if (nearest({ scan, pattern: /^(Banner|Alert)(\.|$)/ })) return "Banner";
  if (small) return "icon-tile";
  const focusable = [...props.keys()].some((prop) => prop.startsWith("_focus"));
  if (focusable) return "input";
  if (/^(radio|option|checkbox|radiogroup)$/.test(role) || props.has("_checked"))
    return "RadioCard";
  if (/(front-door|\/langy\/|expressive)/.test(scan.file)) return "expressive-exception";
  return "card";
}

function recordCardBox({ visit }: { visit: Visit }) {
  const { props, scan } = visit;
  const look: Record<string, string> = {};
  for (const [prop, value] of props) {
    if (LOOK.test(prop)) look[prop] = valueOf({ scan, node: value });
  }
  const rounded = look.borderRadius !== undefined && !PILL_RADIUS.test(look.borderRadius);
  const border = borderOf({ visit });
  const panel = CARD_BG.test(look.bg ?? "");
  const exempt = literalText(props.get("role")) === "alert";
  if (!rounded || (border === "no" && !panel) || exempt) return;
  record({
    visit,
    family: "cards",
    what: "card-box",
    props: look,
    rule: "card-box",
    disposition: "candidate",
    destination: destinationOf({ visit }),
    heuristic: border === "unknown",
    ...(border === "unknown" ? { reason: "border is not a literal" } : {}),
  });
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
      rule: "grid-row",
      disposition: "candidate",
      heuristic: true,
    });
  }
}

/** The semantic level an element renders at: native `h1`, `chakra.h1`, `as="h1"`, Heading's h2. */
function headingLevel({ visit }: { visit: Visit }): number | undefined {
  const { ref, binding, chakra } = visit;
  const native = /^h([1-6])$/.exec(ref);
  if (native && !binding) return Number(native[1]);
  const factory = chakra ? /^chakra\.h([1-6])$/.exec(ref) : undefined;
  if (factory) return Number(factory[1]);
  const asLevel = /^h([1-6])$/.exec(literalText(visit.props.get("as")) ?? "");
  if (asLevel && (chakra || visit.ds)) return Number(asLevel[1]);
  return chakra && ref === "Heading" ? 2 : undefined;
}

function recordHeading({ visit }: { visit: Visit }) {
  const { scan, props } = visit;
  const level = headingLevel({ visit });
  if (level === undefined) return;
  if (nearest({ scan, pattern: /^(PageLayout\.Header|ListPage)$/ })) return;
  const surface = scan.stack.findLast((frame) => frame.family)?.family ?? "page";
  if (visit.chakra && visit.ref === "Heading") {
    const inDrawer = nearest({ scan, pattern: /^(Drawer\.Header|DrawerHeader)$/ });
    if (inDrawer) {
      record({
        visit,
        family: "drawers",
        what: "Heading in Drawer.Header",
        site: false,
        rule: "heading-in-drawer-header",
        disposition: "violation",
        surface,
      });
      return;
    }
  }
  if (level === 1) {
    stateOf({ scan }).headerLine ??= visit.line;
    record({
      visit,
      family: "pageHeaders",
      what: "page-title Heading",
      rule: "page-title-h1",
      disposition: "violation",
      surface,
    });
    return;
  }
  const title =
    TITLE_SIZE.test(literalText(props.get("size")) ?? "") ||
    TITLE_STYLE.test(literalText(props.get("textStyle")) ?? "");
  if (!visit.chakra || visit.ref !== "Heading" || !title) return;
  record({
    visit,
    family: "pageHeaders",
    what: "page-title Heading",
    rule: "page-title-size",
    disposition: "candidate",
    heuristic: true,
    surface,
  });
}

/** A raw Button in PageLayout.Header or ListPage `actions`, where HeaderButton belongs. */
function recordHeaderButton({ visit }: { visit: Visit }) {
  const { scan } = visit;
  if (!/^(Button|IconButton)$/.test(visit.head) || !(visit.ds || visit.chakra)) return;
  const attr = scan.attrs.at(-1);
  const inActions = attr?.name === "actions" && scan.stack[attr.depth - 1]?.ref === "ListPage";
  if (!inActions && !nearest({ scan, pattern: /^PageLayout\.Header$/ })) return;
  record({
    visit,
    family: "pageHeaders",
    what: "raw header Button",
    site: false,
    rule: "raw-header-button",
    disposition: "violation",
  });
}

/** A button that appends rows by hand: a real label is a violation, a guess a candidate. */
function recordAppend({
  visit,
  label,
  dynamic,
}: {
  visit: Visit;
  label: string;
  dynamic: boolean;
}) {
  const click = visit.props.has("onClick")
    ? valueOf({ scan: visit.scan, node: visit.props.get("onClick") })
    : "";
  const fetches = FETCHES.test(click);
  const definite = LOAD_LABEL.test(label) || SHOW_LABEL.test(label);
  const more = MORE_LABEL.test(label);
  const guessed = (dynamic || label === "") && fetches;
  if (!definite && !more && !guessed) return;
  record({
    visit,
    family: "pagination",
    what: label ? `hand append "${label}"` : "hand append (dynamic label)",
    rule: "hand-append",
    disposition: definite || (more && fetches) ? "violation" : "candidate",
    heuristic: !definite,
  });
}

/** What the buttons say: a Prev/Next of one pager, an append action, a destructive confirm. */
function trackButtons({ visit }: { visit: Visit }): Partial<Frame> {
  const { scan, props } = visit;
  if (!/^(Button|IconButton)$/.test(visit.head)) return {};
  const body = labelOf({ element: visit.element, deep: true });
  const label = literalText(props.get("aria-label")) ?? body.text;
  const marks: Partial<Frame> = {};
  const danger =
    literalText(props.get("colorPalette")) === "red" || /^(delete|remove|revoke)\b/i.test(label);
  const dialog = danger ? nearest({ scan, pattern: /^(Dialog\.Root|DialogRoot)$/ }) : undefined;
  if (dialog) dialog.danger ??= visit.line;
  if (PREVIOUS.test(label)) marks.prev = { line: visit.line, hops: 0 };
  if (NEXT.test(label)) marks.next = { line: visit.line, hops: 0 };
  recordAppend({ visit, label, dynamic: body.dynamic });
  return marks;
}

/** Marks that bubble to the nearest two parents; both seen under one parent is one pager. */
function settlePager({ scan, frame }: { scan: Scan; frame: Frame }) {
  if (frame.prev && frame.next && !frame.pager) {
    emit({
      scan,
      loc: { line: frame.prev.line, col: 0 },
      family: "pagination",
      what: "hand Prev/Next buttons",
      rule: "hand-pagination",
      disposition: "violation",
    });
    frame.pager = true;
  }
  const parent = scan.stack.at(-1);
  if (!parent) return;
  if (frame.pager) parent.pager = true;
  else {
    if (frame.prev && frame.prev.hops < 2)
      parent.prev ??= { ...frame.prev, hops: frame.prev.hops + 1 };
    if (frame.next && frame.next.hops < 2)
      parent.next ??= { ...frame.next, hops: frame.next.hops + 1 };
  }
}

/** Hand empty-state text is a reviewed candidate, never a count that can read zero. */
function recordEmptyText({ visit }: { visit: Visit }) {
  if (!EMPTY_TEXT.test(labelOf({ element: visit.element, deep: false }).text)) return;
  const pattern = /^(NoDataInfoBlock|ChartEmptyState|EmptyState\.)/;
  if (nearest({ scan: visit.scan, pattern })) return;
  record({
    visit,
    family: "emptyStates",
    what: "hand empty-state text",
    rule: "empty-text",
    disposition: "candidate",
    heuristic: true,
  });
}

function visitElement({ scan, element }: { scan: Scan; element: AstNode }): Frame | undefined {
  const opening = child(element, "openingElement");
  const resolved = opening ? resolve({ scan, name: child(opening, "name") }) : undefined;
  if (!opening || !resolved) return undefined;
  const { ref, binding } = resolved;
  const chakra = binding !== undefined && isChakraSource(binding.source);
  const { props, unresolved } = propsOf({ scan, opening });
  const loc = locOf({ scan, offset: opening.start });
  const visit: Visit = {
    scan,
    element,
    ref,
    head: ref.split(".")[0] ?? "",
    ds: binding !== undefined && isDsSource(binding.source) && !chakra,
    chakra,
    loc,
    line: loc.line,
    props,
    unresolved,
    ...(binding ? { binding } : {}),
  };
  const shape = recordShape({ visit });
  recordUnknown({ visit, ...(resolved.unknown ? { unknown: resolved.unknown } : {}) });
  recordCopies({ visit });
  const roles = recordRoles({ visit });
  recordLayout({ visit });
  recordHeading({ visit });
  recordHeaderButton({ visit });
  const marks = trackButtons({ visit });
  recordEmptyText({ visit });
  return { ref, ds: visit.ds || chakra, ...roles, ...shape, ...marks };
}

function closeFrame({ scan, frame }: { scan: Scan; frame: Frame }) {
  if (/^(Dialog\.Root|DialogRoot)$/.test(frame.ref) && frame.danger) {
    emit({
      scan,
      loc: { line: frame.danger, col: 0 },
      family: "dialogs",
      what: "hand-built confirm Dialog",
      site: false,
      rule: "hand-confirm",
      disposition: "candidate",
      heuristic: true,
      ...(frame.rootId ? { root: frame.rootId } : {}),
    });
  }
  settlePager({ scan, frame });
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
  scan.attrs.push({ name: raw, depth: scan.stack.length });
  walkChildren({ scan, node });
  scan.attrs.pop();
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

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** A function's parameters and locals can hide an import; a Capitalised one is a component. */
function walkFunction({ scan, node }: { scan: Scan; node: AstNode }) {
  const name = node.type === "FunctionDeclaration" ? text(child(node, "id"), "name") : undefined;
  const component = name !== undefined && /^[A-Z]/.test(name);
  if (component) scan.components.push(name);
  scan.shadow.push(declaredNames({ scan, node }));
  walkChildren({ scan, node });
  scan.shadow.pop();
  if (component) scan.components.pop();
}

function walkDeclarator({ scan, node }: { scan: Scan; node: AstNode }) {
  const name = text(child(node, "id"), "name");
  const init = stripWrappers(child(node, "init"));
  const wraps = init !== undefined && (FUNCTIONS.has(init.type) || init.type === "CallExpression");
  const component = name !== undefined && /^[A-Z]/.test(name) && wraps;
  if (component) scan.components.push(name);
  walkChildren({ scan, node });
  if (component) scan.components.pop();
}

/** `useTabs()` and its kin, called from a raw-tabs source: a part of hand-assembled tabs. */
function recordTabsHook({ scan, node }: { scan: Scan; node: AstNode }) {
  const callee = child(node, "callee");
  const local = callee?.type === "Identifier" ? text(callee, "name") : undefined;
  const hidden = local !== undefined && scan.shadow.some((names) => names.has(local));
  const binding = local && !hidden ? scan.bindings.get(local) : undefined;
  if (!binding || !TABS_HOOKS.has(binding.imported) || binding.members.length) return;
  if (!isChakraSource(binding.source) && !isDsSource(binding.source)) return;
  emit({
    scan,
    loc: locOf({ scan, offset: node.start }),
    family: "tabs",
    what: `${binding.imported}()`,
    site: false,
    rule: "legacy-tabs-part",
    disposition: "violation",
  });
}

function walk({ scan, node }: { scan: Scan; node: AstNode }) {
  if (node.type === "CallExpression") recordTabsHook({ scan, node });
  if (node.type === "JSXAttribute") return walkAttribute({ scan, node });
  if (node.type === "Property") return walkProperty({ scan, node });
  if (FUNCTIONS.has(node.type)) return walkFunction({ scan, node });
  if (node.type === "VariableDeclarator") return walkDeclarator({ scan, node });
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

/** A header and a table inside one component without ListPage: a heuristic, never mandatory. */
function finishFile({ scan }: { scan: Scan }) {
  for (const [name, state] of scan.componentState) {
    if (state.headerLine === undefined || !state.table || state.listPage) continue;
    emit({
      scan,
      loc: { line: state.headerLine, col: 0 },
      family: "listPages",
      what: "header + table in one component, not ListPage",
      rule: "list-page-inference",
      disposition: "candidate",
      heuristic: true,
      root: `${scan.file}::${name}`,
    });
  }
}

/** Who owns a file when it is not part of this rollout. */
export function ownerOf({ file }: { file: string }): string | undefined {
  return UPGRADE_PATH.test(file) ? "upgrade" : undefined;
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
    imported: new Set(),
    constObjects: new Map(),
    unknownLocals: new Map(),
    shadow: [],
    components: [],
    componentState: new Map(),
    attrs: [],
    sites: [],
    literals: [],
    stack: [],
    mapDepth: 0,
    styleDepth: 0,
  };
  for (const name of scan.bindings.keys()) scan.imported.add(name);
  collectAliases({ scan, node: root });
  walk({ scan, node: root });
  finishFile({ scan });
  const owner = ownerOf({ file });
  const sites = owner ? scan.sites.map((site) => ({ ...site, owner })) : scan.sites;
  return { sites, literals: scan.literals };
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
const finding = (site: CensusSite) =>
  site.disposition === "violation" || site.disposition === "unknown";
const hasDrift = (site: CensusSite) => Object.keys(site.props).some((prop) => prop !== "Root.size");

/** `modules/trace/browser/src/x.tsx` -> `modules/trace`; `apps/ui/src/x.tsx` -> `apps/ui`. */
export function moduleOf({ file }: { file: string }): string {
  const parts = file.split("/");
  return parts.slice(0, parts[0] === "enterprise" ? 3 : 2).join("/");
}

/** One family's measurements, each kept apart: roots, affected roots, parts and candidates. */
function familyCensus({ family, sites }: { family: Family; sites: CensusSite[] }): FamilyCensus {
  const own = sites.filter((site) => site.family === family);
  const rooted = own.filter((site) => site.wrapper === undefined);
  const overridden = own.filter((site) => site.kind === "ds" && hasDrift(site));
  const lookalikes = own.filter((site) => site.kind === "lookalike");
  const overriddenProps: Record<string, number> = {};
  const values = new Map<string, Set<string>>();
  const kinds = { cosmetic: 0, geometry: 0, opaque: 0 };
  for (const site of own.filter((s) => s.kind === "ds")) {
    for (const [prop, value] of Object.entries(site.props)) {
      if (prop !== "Root.size") bump(overriddenProps, prop);
      values.set(prop, (values.get(prop) ?? new Set()).add(value));
    }
    const present = new Set(
      Object.keys(site.props)
        .filter((prop) => prop !== "Root.size")
        .map((prop) => driftKind({ prop })),
    );
    for (const kind of present) kinds[kind]++;
  }
  const lookalikeKinds: Record<string, number> = {};
  for (const site of lookalikes) bump(lookalikeKinds, site.what);
  const violationsByRule: Record<string, number> = {};
  for (const site of rooted.filter(finding)) bump(violationsByRule, site.rule);
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
    roots: new Set(rooted.map((site) => site.root)).size,
    affectedRoots: new Set(rooted.filter(finding).map((site) => site.root)).size,
    parts: rooted.filter(finding).length,
    candidates: own.filter((site) => site.disposition === "candidate").length,
    adoptedRoots: new Set(rooted.filter((s) => s.adopted && s.site).map((s) => s.root)).size,
    unknown: own.filter((site) => site.disposition === "unknown").length,
    callers: own.length - rooted.length,
    cosmeticParts: kinds.cosmetic,
    geometryParts: kinds.geometry,
    opaqueParts: kinds.opaque,
    violationsByRule,
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

/** Adds one site to its file's score, its module's families and its owner's tally. */
function tallySite({
  site,
  score,
  moduleFamilies,
  owners,
}: {
  site: CensusSite;
  score: FileScore;
  moduleFamilies: Map<string, Record<string, number>>;
  owners: Census["owners"];
}) {
  const drift = site.disposition !== "adopted" && site.disposition !== "clean";
  if (site.kind === "ds" && site.site) score.ds++;
  if (site.kind === "lookalike") score.lookalike++;
  else if (drift) score.overridden++;
  if (!drift) return;
  if (site.owner) {
    const entry = (owners[site.owner] ??= { violations: 0, candidates: 0, unknown: 0 });
    entry[tallyKey(site)]++;
  }
  score.score++;
  const counts = moduleFamilies.get(moduleOf({ file: site.file })) ?? {};
  bump(counts, site.family);
  moduleFamilies.set(moduleOf({ file: site.file }), counts);
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
  const owners: Census["owners"] = {};
  for (const site of sites) {
    tallySite({ site, score: scoreOf(site.file), moduleFamilies, owners });
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
    owners,
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

const GLOB_TOKENS: [RegExp, string][] = [
  [/[.+^${}()|[\]\\]/g, "\\$&"],
  [/\*\*\//g, "\uE000"],
  [/\*\*/g, "\uE001"],
  [/\*/g, "[^/]*"],
  [/\?/g, "[^/]"],
  [/\uE000/g, "(?:.*/)?"],
  [/\uE001/g, ".*"],
];

/** A path against a glob (`*`, `**`, `?`) or a plain directory or file prefix. */
export function matchesPath({ file, glob }: { file: string; glob: string }): boolean {
  if (!/[*?]/.test(glob)) return file === glob || file.startsWith(`${glob.replace(/\/+$/, "")}/`);
  const source = GLOB_TOKENS.reduce((acc, [pattern, to]) => acc.replace(pattern, to), glob);
  return new RegExp(`^${source}$`).test(file);
}

export function collectCensus({ paths }: { paths?: string[] } = {}): {
  census: Census;
  sites: CensusSite[];
  literals: LiteralSite[];
  files: string[];
  sources: Map<string, string>;
} {
  const sites: CensusSite[] = [];
  const literals: LiteralSite[] = [];
  const sources = new Map<string, string>();
  const files = browserSources().filter(
    (file) => !paths?.length || paths.some((glob) => matchesPath({ file, glob })),
  );
  for (const file of files) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    sources.set(file, source);
    const found = censusSites({ file, source });
    sites.push(...found.sites);
    literals.push(...found.literals);
  }
  return { census: summariseCensus({ sites, literals }), sites, literals, files, sources };
}

export type Escape = {
  path: string;
  rule: string;
  reason: string;
  owner: string;
  /** Narrows the entry to one source line; omitted, it covers the rule anywhere in the path. */
  line?: number;
  /** `escape` approves a violation; `reviewed` gives a candidate or unknown its disposition. */
  disposition?: "escape" | "reviewed";
};

function readEscape({
  entry,
  index,
  file,
}: {
  entry: unknown;
  index: number;
  file: string;
}): Escape {
  const read = (key: string) => {
    const value = isRecord(entry) ? entry[key] : undefined;
    if (typeof value === "string" && value.trim()) return value;
    throw new Error(`${file} entry ${index} needs a non-empty "${key}"`);
  };
  const disposition = isRecord(entry) ? entry.disposition : undefined;
  const line = isRecord(entry) ? entry.line : undefined;
  if (line !== undefined && !(Number.isInteger(line) && Number(line) > 0)) {
    throw new Error(`${file} entry ${index} needs "line" to be a positive integer`);
  }
  return {
    ...(typeof line === "number" ? { line } : {}),
    path: read("path"),
    rule: read("rule"),
    reason: read("reason"),
    owner: read("owner"),
    ...(disposition === "reviewed" || disposition === "escape" ? { disposition } : {}),
  };
}

/** The approved escapes and reviewed candidates, read from `census-escapes.json`. */
export function loadEscapes({ file = ESCAPES_FILE }: { file?: string } = {}): Escape[] {
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} must hold an array of escapes`);
  return parsed.map((entry: unknown, index) => readEscape({ entry, index, file }));
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export type Finding = {
  file: string;
  line: number;
  root: string;
  family: Family;
  rule: string;
  what: string;
  owner?: string;
  destination?: string;
  reason?: string;
  escape?: Pick<Escape, "reason" | "owner">;
};
export type CheckResult = {
  violations: Finding[];
  approvedEscapes: Finding[];
  unclassifiedCandidates: Finding[];
  classifiedCandidates: Finding[];
  unknown: Finding[];
  adoptedRoots: (Finding & { source?: string; planned: boolean })[];
  ownedElsewhere: Record<string, { violations: number; candidates: number; unknown: number }>;
};

function plannedSubpaths(): Set<string> {
  const manifest: unknown = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  const exports = isRecord(manifest) && isRecord(manifest.exports) ? manifest.exports : {};
  const exported = new Set(Object.keys(exports));
  return new Set(
    Object.values(TARGET)
      .map((entry) => entry.subpath)
      .filter(
        (subpath): subpath is string => subpath !== undefined && !exported.has(`./${subpath}`),
      ),
  );
}

/** The registered target API: export, source and whether the subpath is exported yet. */
export function targetApi(): {
  export: string;
  source: string;
  family: Family;
  planned: boolean;
}[] {
  const planned = plannedSubpaths();
  return Object.entries(TARGET).map(([name, entry]) => ({
    export: name,
    source: entry.subpath
      ? `@langwatch/design-system/${entry.subpath}`
      : "@langwatch/design-system",
    family: entry.family,
    planned: entry.subpath !== undefined && planned.has(entry.subpath),
  }));
}

const findingOf = (site: CensusSite): Finding => ({
  file: site.file,
  line: site.line,
  root: site.root,
  family: site.family,
  rule: site.rule,
  what: site.what,
  ...(site.owner ? { owner: site.owner } : {}),
  ...(site.destination ? { destination: site.destination } : {}),
  ...(site.reason ? { reason: site.reason } : {}),
});

function sortSite({
  site,
  escapes,
  result,
}: {
  site: CensusSite;
  escapes: Escape[];
  result: CheckResult;
}) {
  const base = findingOf(site);
  if (site.owner) {
    const entry = (result.ownedElsewhere[site.owner] ??= {
      violations: 0,
      candidates: 0,
      unknown: 0,
    });
    entry[tallyKey(site)]++;
    return;
  }
  const escape = escapes.find(
    (entry) =>
      matchesPath({ file: site.file, glob: entry.path }) &&
      (entry.rule === "*" || entry.rule === site.rule) &&
      (entry.line === undefined || entry.line === site.line),
  );
  if (escape) {
    result.approvedEscapes.push({
      ...base,
      escape: { reason: escape.reason, owner: escape.owner },
    });
  } else if (site.disposition === "violation") result.violations.push(base);
  else if (site.disposition === "unknown") result.unknown.push(base);
  else if (site.destination && NOT_A_CARD.has(site.destination)) {
    result.classifiedCandidates.push(base);
  } else result.unclassifiedCandidates.push(base);
}

function tallyKey(site: CensusSite): "violations" | "candidates" | "unknown" {
  if (site.disposition === "violation") return "violations";
  return site.disposition === "candidate" ? "candidates" : "unknown";
}

/** Sorts sites into the four lists a wave is judged by; owned-elsewhere files stay visible. */
export function evaluateCheck({
  sites,
  escapes,
}: {
  sites: CensusSite[];
  escapes: Escape[];
}): CheckResult {
  const planned = plannedSubpaths();
  const result: CheckResult = {
    violations: [],
    approvedEscapes: [],
    unclassifiedCandidates: [],
    classifiedCandidates: [],
    unknown: [],
    adoptedRoots: [],
    ownedElsewhere: {},
  };
  for (const site of sites) {
    if (site.adopted && site.site) {
      const subpath = site.source?.split("/")[2];
      const planning = subpath !== undefined && planned.has(subpath);
      result.adoptedRoots.push({
        ...findingOf(site),
        ...(site.source ? { source: site.source } : {}),
        planned: planning,
      });
    }
    if (site.disposition !== "adopted" && site.disposition !== "clean") {
      sortSite({ site, escapes, result });
    }
  }
  return result;
}

/** 1 for an unsuppressed violation; 2 for an unclassified candidate or unknown; 0 passes. */
export function exitCodeOf({ result }: { result: CheckResult }): 0 | 1 | 2 {
  if (result.violations.length) return 1;
  return result.unclassifiedCandidates.length || result.unknown.length ? 2 : 0;
}

/** Why a gate proves nothing (exit 3): no sources, a glob matching none, too few adopted roots. */
export function gateRefusal({
  paths,
  files,
  adopted,
  minimum,
}: {
  paths: string[];
  files: string[];
  adopted: number;
  minimum: number;
}): string | undefined {
  if (!files.length) return `No browser source matches ${paths.join(" ")}`;
  const empty = paths.filter((glob) => !files.some((file) => matchesPath({ file, glob })));
  if (empty.length) return `No browser source matches ${empty.join(" ")}`;
  if (!Number.isInteger(minimum) || minimum < 0) return "--min-adopted needs a whole number";
  return adopted < minimum
    ? `${adopted} adopted roots, fewer than --min-adopted ${minimum}`
    : undefined;
}

/** The owners (upgrade) whose rows still hold a violation, candidate or unknown. */
export function openOwners({ result }: { result: CheckResult }): string[] {
  return Object.entries(result.ownedElsewhere)
    .filter(([, entry]) => entry.violations + entry.candidates + entry.unknown > 0)
    .map(([owner]) => owner);
}

/** The commit and a hash of the scanned sources: what the verdict is true of. */
export function revisionOf({ sources }: { sources: Map<string, string> }) {
  const hash = createHash("sha256");
  for (const file of [...sources.keys()].toSorted()) hash.update(`${file}\0${sources.get(file)}\0`);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  return { commit, contentHash: hash.digest("hex").slice(0, 16), files: sources.size };
}

const display = (value: string, max = 96) =>
  value.length > max ? `${value.slice(0, max - 1)}...` : value;

function familySection({ family, entry }: { family: Family; entry: FamilyCensus }): string[] {
  const out = [`## ${family}`, ""];
  const tally = (counts: Record<string, number>) =>
    Object.entries(counts)
      .map(([key, count]) => `${key} ${count}`)
      .join(", ");
  out.push(
    `Roots ${entry.roots}, affected ${entry.affectedRoots}, parts ${entry.parts}, candidates ${entry.candidates}, adopted ${entry.adoptedRoots}, unknown ${entry.unknown}, wrapper callers ${entry.callers}.`,
    "",
  );
  if (Object.keys(entry.violationsByRule).length) {
    out.push(`Findings by rule: ${tally(entry.violationsByRule)}.`, "");
  }
  if (entry.overridden) out.push(`Restyled props: ${tally(entry.overriddenProps)}.`, "");
  if (entry.overridden) out.push(`Distinct values per prop: ${tally(entry.distinctValues)}.`, "");
  if (entry.lookalike) out.push(`Look-alikes and candidates: ${tally(entry.lookalikeKinds)}.`, "");
  if (!entry.clusters.length) return out;
  out.push("| Count | Signature | Examples |", "| ---: | --- | --- |");
  for (const cluster of entry.clusters) {
    const signature = display(cluster.signature).replaceAll("|", "\\|");
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
    "`Roots` are distinct roots; `Affected` roots carry at least one violation or unknown part (parts are attributed to their owning root); `Parts` are the violating sites; `Candidates` are heuristic findings a person must classify.",
    "Scores rank work and are not migration counts. Signatures are distinct expressions, not validated designs. Upgrade-owned files are counted and listed under their owner.",
    "",
    "| Family | Roots | Affected | Parts | Candidates | Adopted | Unknown | Cosmetic | Geometry | Signatures |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const family of FAMILIES) {
    const entry = census.families[family];
    out.push(
      `| ${family} | ${entry.roots} | ${entry.affectedRoots} | ${entry.parts} | ${entry.candidates} | ${entry.adoptedRoots} | ${entry.unknown} | ${entry.cosmeticParts} | ${entry.geometryParts} | ${entry.variants} |`,
    );
  }
  out.push(
    "",
    `Literal spacing and type in browser code: ${census.literals.pixelSpacing} pixel paddings, margins or gaps; ${census.literals.fontSize} literal font sizes.`,
    "",
  );
  const owners = Object.entries(census.owners);
  if (owners.length) {
    out.push("Owned elsewhere (counted, outside our waves):", "");
    for (const [owner, tally] of owners) {
      out.push(
        `- ${owner}: ${tally.violations} violations, ${tally.candidates} candidates, ${tally.unknown} unknown`,
      );
    }
    out.push("");
  }
  for (const family of FAMILIES)
    out.push(...familySection({ family, entry: census.families[family] }));
  out.push(
    "## The 30 highest-scoring files",
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

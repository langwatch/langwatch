/**
 * The templates finder: every catalogue template with what its card shows, most needed first,
 * the pool an agent type picks, the trunk sections, and the address that carries the search and
 * chips so a link shares the view. The narrowing itself is the shared catalogue filter.
 * @see modules/dashboard/specs/dashboards-finder.feature
 */

import { CHART_GRID_DEFAULT_COL_SPAN } from "../../../model/chart-grid.ts";
import {
  AGENT_KINDS,
  type AgentKind,
  CATALOGUE_TEMPLATES,
  CATALOGUE_WIDGETS,
  focusTemplateId,
  GALLERY_VARIANTS,
  type CatalogueTemplate,
  implementedWidget,
  type QuestionType,
  stackWidgets,
  TEMPLATE_VARIANTS,
  TRUNKS,
  type Trunk,
} from "../catalogue/index.ts";
import {
  BOARD_TEMPLATES,
  type BoardTemplate,
  type BoardTemplateWidget,
} from "../templates/index.ts";
import { BOARD_WIDGET_DEFAULT_ROW_SPAN } from "./board-grid.ts";
import {
  type CatalogueFilters,
  type CatalogueItem,
  type CatalogueSection,
  catalogueSearchText,
  catalogueSections,
} from "./catalogue-filter.ts";

/**
 * Templates with a board image captured from preview sample data, served at `templatePreviewSrc`.
 * @see dev/scripts/template-previews/capture.mjs, which makes them
 */
export const TEMPLATE_PREVIEW_IDS: ReadonlySet<string> = new Set([
  "cockpit",
  "costs",
  "models",
  "asks",
  "answers",
  "breaks",
  "speed",
  "tools",
  "release",
  "change",
  "evals",
  "signoff",
  "customers",
  "calls",
  "fields",
  "outputs",
  "cockpit__voice",
  "cockpit__generative",
  "costs__voice",
  "costs__extraction",
  "answers__rag",
  "answers__voice",
  "answers__extraction",
  "answers__tools-agent",
  "answers__generative",
  "breaks__tools-agent",
  "speed__voice",
  "release__rag",
  "release__voice",
  "release__extraction",
  "release__regulated",
  "release__tools-agent",
  "release__generative",
  "data",
]);

/** The themes a template image is captured in. */
export type PreviewTheme = "light" | "dark";

/** Where a captured template image is served from, in one theme. */
export function templatePreviewSrc({
  templateId,
  theme,
}: {
  templateId: string;
  theme: PreviewTheme;
}): string {
  return `/images/dashboards/templates/${theme}/${templateId}.webp`;
}

/** The faint stand-in a sketched widget shows in place of its chart. */
export type PreviewPlaceholder = "tile" | "line" | "bars";

/** One widget of a sketched preview: its title where it sits on the board. */
export interface PreviewWidget {
  readonly key: string;
  readonly title: string;
  readonly placeholder: PreviewPlaceholder;
  readonly layout: BoardTemplateWidget["layout"];
}

/** A card's preview: the template's real board as an image, or a sketch of its layout. */
export type TemplatePreview =
  | { readonly kind: "image"; readonly src: Readonly<Record<PreviewTheme, string>> }
  | { readonly kind: "layout"; readonly widgets: readonly PreviewWidget[] };

/** One template as the finder lists it; `board` is what "Add to this project" makes. */
export interface LibraryTemplate extends CatalogueItem {
  readonly board: BoardTemplate;
  readonly widgetCount: number;
  readonly preview: TemplatePreview;
  /** The one agent type the template is made for; its chip finds it. */
  readonly focusKind?: AgentKind;
}

const WIDGETS = new Map(CATALOGUE_WIDGETS.map((widget) => [widget.id, widget]));

const PLACEHOLDERS: Readonly<Record<QuestionType, PreviewPlaceholder>> = {
  happened: "tile",
  changed: "line",
  line: "line",
  compare: "bars",
  why: "bars",
  matters: "bars",
  prove: "tile",
};

/** An unbuilt widget has no size yet; it is sketched at the default new-widget footprint. */
const UNBUILT_LAYOUT = {
  gridColumn: 0,
  gridRow: 0,
  colSpan: CHART_GRID_DEFAULT_COL_SPAN,
  rowSpan: BOARD_WIDGET_DEFAULT_ROW_SPAN,
};

function previewOf(template: CatalogueTemplate): TemplatePreview {
  if (TEMPLATE_PREVIEW_IDS.has(template.id)) {
    const src = (theme: PreviewTheme) => templatePreviewSrc({ templateId: template.id, theme });
    return { kind: "image", src: { light: src("light"), dark: src("dark") } };
  }
  const widgets = template.widgets.flatMap((id): PreviewWidget[] => {
    const widget = WIDGETS.get(id);
    if (!widget) return [];
    return [
      {
        key: id,
        title: widget.title,
        placeholder: PLACEHOLDERS[widget.questionType],
        layout: implementedWidget(id)?.layout ?? UNBUILT_LAYOUT,
      },
    ];
  });
  return { kind: "layout", widgets: stackWidgets(widgets) };
}

function libraryTemplate({
  board,
  template,
}: {
  board: BoardTemplate;
  template: CatalogueTemplate;
}): LibraryTemplate {
  const { focusKind } = template;
  const agentKinds = focusKind ? [focusKind] : template.preloadFor;
  const questions = template.widgets.map((id) => WIDGETS.get(id)?.question ?? "");
  return {
    board,
    trunk: template.trunk,
    widgetCount: template.widgets.length,
    searchText: catalogueSearchText({
      words: [template.name, template.job, ...questions],
      agentKinds,
    }),
    preview: previewOf(template),
    ...(focusKind ? { focusKind } : {}),
  };
}

/** Kept out of the finder: coding-agent boards live with coding agents; org boards come later. */
const isHidden = ({ scope, focusKind }: CatalogueTemplate): boolean =>
  scope === "org" || focusKind === "coding";

const CATALOGUE_BY_ID = new Map(
  [...CATALOGUE_TEMPLATES, ...TEMPLATE_VARIANTS].map((template) => [template.id, template]),
);

function libraryOf(boards: readonly BoardTemplate[]): LibraryTemplate[] {
  return boards.flatMap((board) => {
    const template = CATALOGUE_BY_ID.get(board.id);
    return template && !isHidden(template) ? [libraryTemplate({ board, template })] : [];
  });
}

/** Every template the finder lists, built or not, one per job, most needed first. */
export const TEMPLATE_LIBRARY: readonly LibraryTemplate[] = libraryOf(BOARD_TEMPLATES);

/** Each template adapted to an agent kind, listed in its place when that kind is picked. */
const KIND_LIBRARY: readonly LibraryTemplate[] = libraryOf(GALLERY_VARIANTS);

const isReady = ({ board }: LibraryTemplate) => board.comingSoon === void 0;

/** The templates that can be made today; one still missing widget code is not offered. */
const READY_TEMPLATES = TEMPLATE_LIBRARY.filter(isReady);

/** The template made for one agent kind: its variant for that kind, else itself if made for it. */
function madeFor({
  template,
  agentKind,
}: {
  template: LibraryTemplate;
  agentKind: AgentKind;
}): LibraryTemplate[] {
  const variantId = focusTemplateId({ baseId: template.board.id, kind: agentKind });
  const variant = KIND_LIBRARY.find(({ board }) => board.id === variantId);
  if (variant) return [variant];
  return template.focusKind === agentKind ? [template] : [];
}

/**
 * The templates a finder view offers: every ready template when no agent type is picked, else
 * the ones made for that type, each adapted to it, in the same order.
 */
export function finderPool({ agentKind }: { agentKind?: AgentKind }): readonly LibraryTemplate[] {
  if (!agentKind) return READY_TEMPLATES;
  return TEMPLATE_LIBRARY.flatMap((template) => madeFor({ template, agentKind })).filter(isReady);
}

/** One trunk's templates on the finder. */
export type TemplateSection = CatalogueSection<Trunk, LibraryTemplate>;

/** Sections in the question tree's trunk order; empty trunks left out. */
export function templateSections({
  templates,
}: {
  templates: readonly LibraryTemplate[];
}): TemplateSection[] {
  return catalogueSections({ items: templates, keys: TRUNKS, keyOf: ({ trunk }) => trunk });
}

/** Only the chips: the finder has no search box of its own, the ask bar is the one. */
const QUERY_KEYS = {
  trunk: "trunk",
  agentKind: "agent",
} as const satisfies Record<Exclude<keyof CatalogueFilters, "search">, string>;

const oneOf = <Value extends string>({
  raw,
  values,
}: {
  raw: string | undefined;
  values: readonly Value[];
}): Value | undefined => values.find((value) => value === raw);

/** The view an address opens; unknown chip values are dropped. */
export function templateFiltersFromQuery(
  query: Readonly<Record<string, string | undefined>>,
): CatalogueFilters {
  const trunk = oneOf({ raw: query[QUERY_KEYS.trunk], values: TRUNKS });
  const agentKind = oneOf({ raw: query[QUERY_KEYS.agentKind], values: AGENT_KINDS });
  return {
    search: "",
    ...(trunk ? { trunk } : {}),
    ...(agentKind ? { agentKind } : {}),
  };
}

/** The address query for a view, over the rest of the query; an empty field leaves its key out. */
export function templateFiltersQuery({
  query,
  filters,
}: {
  query: Readonly<Record<string, string | undefined>>;
  filters: CatalogueFilters;
}): Record<string, string | undefined> {
  return {
    ...query,
    [QUERY_KEYS.trunk]: filters.trunk,
    [QUERY_KEYS.agentKind]: filters.agentKind,
  };
}

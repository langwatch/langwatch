/**
 * The templates finder: every catalogue template with what its card shows, the pool an agent
 * type picks, the trunk sections, and the address that carries the search and chips so a link
 * shares the view. The narrowing itself is the shared catalogue filter.
 * @see modules/dashboard/specs/dashboards-finder.feature
 */

import { CHART_GRID_COLUMNS } from "../../../model/chart-grid.ts";
import {
  AGENT_KINDS,
  type AgentKind,
  CATALOGUE_TEMPLATES,
  CATALOGUE_WIDGETS,
  type CatalogueTemplate,
  implementedWidget,
  type QuestionType,
  stackWidgets,
  TRUNKS,
  type Trunk,
} from "../catalogue/index.ts";
import {
  BOARD_TEMPLATES,
  type BoardTemplate,
  type BoardTemplateWidget,
} from "../templates/index.ts";
import {
  type CatalogueFilters,
  type CatalogueItem,
  type CatalogueSection,
  catalogueSearchText,
  catalogueSections,
} from "./catalogue-filter.ts";

/** Templates with a board image captured from the demo seed, served at `templatePreviewSrc`. */
export const TEMPLATE_PREVIEW_IDS: ReadonlySet<string> = new Set([
  "cockpit",
  "costs",
  "models",
  "asks",
  "answers",
  "unanswered",
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
  "unanswered__rag",
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

/** Where a captured template image is served from. */
export function templatePreviewSrc(templateId: string): string {
  return `/images/dashboards/templates/${templateId}.webp`;
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
  | { readonly kind: "image"; readonly src: string }
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

/** An unbuilt widget has no size yet; it is sketched half wide, at the shortest card height. */
const UNBUILT_LAYOUT = { gridColumn: 0, gridRow: 0, colSpan: CHART_GRID_COLUMNS / 2, rowSpan: 3 };

function previewOf(template: CatalogueTemplate): TemplatePreview {
  if (TEMPLATE_PREVIEW_IDS.has(template.id)) {
    return { kind: "image", src: templatePreviewSrc(template.id) };
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

const CATALOGUE_BY_ID = new Map(CATALOGUE_TEMPLATES.map((template) => [template.id, template]));

/** Every template the finder knows, built or not, each base followed by its focus templates. */
export const TEMPLATE_LIBRARY: readonly LibraryTemplate[] = BOARD_TEMPLATES.flatMap((board) => {
  const template = CATALOGUE_BY_ID.get(board.id);
  return template && !isHidden(template) ? [libraryTemplate({ board, template })] : [];
});

/** The templates that can be made today; one still missing widget code is not offered. */
const READY_TEMPLATES = TEMPLATE_LIBRARY.filter(({ board }) => board.comingSoon === void 0);

/**
 * The templates a finder view offers: every ready template when no agent type is picked,
 * else only the ones made for that type.
 */
export function finderPool({ agentKind }: { agentKind?: AgentKind }): readonly LibraryTemplate[] {
  if (!agentKind) return READY_TEMPLATES;
  return READY_TEMPLATES.filter(({ focusKind }) => focusKind === agentKind);
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

const QUERY_KEYS = {
  search: "q",
  trunk: "trunk",
  agentKind: "agent",
} as const satisfies Record<keyof CatalogueFilters, string>;

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
    search: query[QUERY_KEYS.search] ?? "",
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
    [QUERY_KEYS.search]: filters.search || void 0,
    [QUERY_KEYS.trunk]: filters.trunk,
    [QUERY_KEYS.agentKind]: filters.agentKind,
  };
}

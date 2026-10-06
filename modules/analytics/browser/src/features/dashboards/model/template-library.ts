/**
 * The templates library: every catalogue template with what its card shows, its trunk
 * sections, and the address that carries the search and chips so a link shares the view.
 * The narrowing itself is the shared catalogue filter.
 * @see modules/dashboard/specs/dashboards-v2.feature
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
  CATALOGUE_STATUSES,
} from "./catalogue-filter.ts";

/** Templates with a board image captured from the demo seed, served at `templatePreviewSrc`. */
export const TEMPLATE_PREVIEW_IDS: ReadonlySet<string> = new Set(["cockpit"]);

/** Where a captured template image is served from. */
export function templatePreviewSrc(templateId: string): string {
  return `/images/dashboards/templates/${templateId}.png`;
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

/** One template as the library lists it; `board` is what "Create board" makes. */
export interface LibraryTemplate extends CatalogueItem {
  readonly board: BoardTemplate;
  readonly widgetCount: number;
  readonly preview: TemplatePreview;
}

const QUESTIONS = new Map(CATALOGUE_WIDGETS.map(({ id, question }) => [id, question]));
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

function agentKindsOf(template: CatalogueTemplate): AgentKind[] {
  const named = new Set<AgentKind>([
    ...template.preloadFor,
    ...(Object.keys(template.byAgentKind) as AgentKind[]),
  ]);
  return AGENT_KINDS.filter((kind) => named.has(kind));
}

function libraryTemplate({
  board,
  template,
}: {
  board: BoardTemplate;
  template: CatalogueTemplate;
}): LibraryTemplate {
  const agentKinds = agentKindsOf(template);
  const widgetIds = new Set([
    ...template.widgets,
    ...Object.values(template.byAgentKind).flatMap((ids) => ids ?? []),
  ]);
  const searchText = catalogueSearchText({
    words: [template.name, template.job, ...[...widgetIds].map((id) => QUESTIONS.get(id) ?? "")],
    agentKinds,
  });
  return {
    board,
    trunk: template.trunk,
    agentKinds,
    widgetCount: template.widgets.length,
    status: board.comingSoon ? "coming-soon" : "ready",
    searchText,
    preview: previewOf(template),
  };
}

const CATALOGUE_BY_ID = new Map(CATALOGUE_TEMPLATES.map((template) => [template.id, template]));

/** Every catalogue template, in the gallery's order: the ones that can be made first. */
export const TEMPLATE_LIBRARY: readonly LibraryTemplate[] = BOARD_TEMPLATES.flatMap((board) => {
  const template = CATALOGUE_BY_ID.get(board.id);
  return template ? [libraryTemplate({ board, template })] : [];
});

/** One trunk's templates on the library screen. */
export type TemplateSection = CatalogueSection<Trunk, LibraryTemplate>;

/** Sections in the question tree's trunk order, ready templates first; empty trunks left out. */
export function templateSections({
  templates,
}: {
  templates: readonly LibraryTemplate[];
}): TemplateSection[] {
  return catalogueSections({ items: templates, keys: TRUNKS, keyOf: ({ trunk }) => trunk });
}

const QUERY_KEYS = {
  search: "q",
  trunks: "trunk",
  agentKinds: "agent",
  statuses: "status",
} as const satisfies Record<keyof CatalogueFilters, string>;

function pickedFrom<Value extends string>({
  raw,
  values,
}: {
  raw: string | undefined;
  values: readonly Value[];
}): Value[] {
  const picked = new Set((raw ?? "").split(","));
  return values.filter((value) => picked.has(value));
}

/** The view an address opens; unknown chip values are dropped. */
export function templateFiltersFromQuery(
  query: Readonly<Record<string, string | undefined>>,
): CatalogueFilters {
  return {
    search: query[QUERY_KEYS.search] ?? "",
    trunks: pickedFrom({ raw: query[QUERY_KEYS.trunks], values: TRUNKS }),
    agentKinds: pickedFrom({ raw: query[QUERY_KEYS.agentKinds], values: AGENT_KINDS }),
    statuses: pickedFrom({ raw: query[QUERY_KEYS.statuses], values: CATALOGUE_STATUSES }),
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
  const listed = (values: readonly string[]) => (values.length ? values.join(",") : void 0);
  return {
    ...query,
    [QUERY_KEYS.search]: filters.search || void 0,
    [QUERY_KEYS.trunks]: listed(filters.trunks),
    [QUERY_KEYS.agentKinds]: listed(filters.agentKinds),
    [QUERY_KEYS.statuses]: listed(filters.statuses),
  };
}

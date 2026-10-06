/**
 * The templates library: every catalogue template with what its card shows, and the search,
 * filter chips and trunk sections the library screen narrows it with. The address carries
 * the view, so a link shares it. @see modules/dashboard/specs/dashboards-v2.feature
 */

import {
  AGENT_KIND_LABELS,
  AGENT_KINDS,
  type AgentKind,
  CATALOGUE_TEMPLATES,
  CATALOGUE_WIDGETS,
  type CatalogueTemplate,
  TRUNKS,
  type Trunk,
} from "../catalogue/index.ts";
import { BOARD_TEMPLATES, type BoardTemplate } from "../templates/index.ts";

export const TEMPLATE_STATUSES = ["ready", "coming-soon"] as const;
/** Whether a board can be made from the template today. */
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TEMPLATE_STATUS_LABELS: Readonly<Record<TemplateStatus, string>> = {
  ready: "Ready",
  "coming-soon": "Coming soon",
};

/** One template as the library lists it; `board` is what "Create board" makes. */
export interface LibraryTemplate {
  readonly board: BoardTemplate;
  readonly trunk: Trunk;
  /** The agent kinds the template is made for; empty when it suits every kind. */
  readonly agentKinds: readonly AgentKind[];
  readonly widgetCount: number;
  readonly status: TemplateStatus;
  /** Name, job, widget questions and agent kinds, lower-cased, for the search box. */
  readonly searchText: string;
}

/** What the member narrowed the library to; an empty group means every value. */
export interface TemplateLibraryFilters {
  readonly search: string;
  readonly trunks: readonly Trunk[];
  readonly agentKinds: readonly AgentKind[];
  readonly statuses: readonly TemplateStatus[];
}

export const NO_TEMPLATE_FILTERS: TemplateLibraryFilters = {
  search: "",
  trunks: [],
  agentKinds: [],
  statuses: [],
};

/** A chip group: the filter field it writes. */
type TemplateFilterGroup = Exclude<keyof TemplateLibraryFilters, "search">;

const QUESTIONS = new Map(CATALOGUE_WIDGETS.map(({ id, question }) => [id, question]));

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
  const searchText = [
    template.name,
    template.job,
    ...[...widgetIds].map((id) => QUESTIONS.get(id) ?? ""),
    ...agentKinds.flatMap((kind) => [kind, AGENT_KIND_LABELS[kind]]),
  ]
    .join("\n")
    .toLowerCase();
  return {
    board,
    trunk: template.trunk,
    agentKinds,
    widgetCount: template.widgets.length,
    status: board.comingSoon ? "coming-soon" : "ready",
    searchText,
  };
}

const CATALOGUE_BY_ID = new Map(CATALOGUE_TEMPLATES.map((template) => [template.id, template]));

/** Every catalogue template, in the gallery's order: the ones that can be made first. */
export const TEMPLATE_LIBRARY: readonly LibraryTemplate[] = BOARD_TEMPLATES.flatMap((board) => {
  const template = CATALOGUE_BY_ID.get(board.id);
  return template ? [libraryTemplate({ board, template })] : [];
});

/** Whether a template passes one chip group; an empty pick passes every template. */
function passesGroup({
  template,
  group,
  picked,
}: {
  template: LibraryTemplate;
  group: TemplateFilterGroup;
  picked: readonly string[];
}): boolean {
  if (picked.length === 0) return true;
  switch (group) {
    case "trunks":
      return picked.includes(template.trunk);
    case "agentKinds":
      return (
        template.agentKinds.length === 0 ||
        template.agentKinds.some((kind) => picked.includes(kind))
      );
    case "statuses":
      return picked.includes(template.status);
  }
}

const FILTER_GROUPS: readonly TemplateFilterGroup[] = ["trunks", "agentKinds", "statuses"];

function matches({
  template,
  filters,
  except,
}: {
  template: LibraryTemplate;
  filters: TemplateLibraryFilters;
  except?: TemplateFilterGroup;
}): boolean {
  const search = filters.search.trim().toLowerCase();
  if (search && !template.searchText.includes(search)) return false;
  return FILTER_GROUPS.every(
    (group) => group === except || passesGroup({ template, group, picked: filters[group] }),
  );
}

/** The templates the search and chips leave: any chip within a group, every group together. */
export function filterTemplates({
  templates,
  filters,
}: {
  templates: readonly LibraryTemplate[];
  filters: TemplateLibraryFilters;
}): LibraryTemplate[] {
  return templates.filter((template) => matches({ template, filters }));
}

/** One chip's count: the templates it would show with the search and the other groups applied. */
export interface TemplateChipCounts {
  readonly trunks: { readonly all: number; readonly byValue: Readonly<Record<Trunk, number>> };
  readonly agentKinds: {
    readonly all: number;
    readonly byValue: Readonly<Record<AgentKind, number>>;
  };
  readonly statuses: {
    readonly all: number;
    readonly byValue: Readonly<Record<TemplateStatus, number>>;
  };
}

function groupCounts<Value extends string>({
  templates,
  filters,
  group,
  values,
}: {
  templates: readonly LibraryTemplate[];
  filters: TemplateLibraryFilters;
  group: TemplateFilterGroup;
  values: readonly Value[];
}): { all: number; byValue: Record<Value, number> } {
  const open = templates.filter((template) => matches({ template, filters, except: group }));
  const countFor = (value: Value) =>
    open.filter((template) => passesGroup({ template, group, picked: [value] })).length;
  const byValue = Object.fromEntries(values.map((value) => [value, countFor(value)]));
  return { all: open.length, byValue: byValue as Record<Value, number> };
}

/** Every chip's count, faceted: a group never narrows its own counts. */
export function templateChipCounts({
  templates,
  filters,
}: {
  templates: readonly LibraryTemplate[];
  filters: TemplateLibraryFilters;
}): TemplateChipCounts {
  return {
    trunks: groupCounts({ templates, filters, group: "trunks", values: TRUNKS }),
    agentKinds: groupCounts({ templates, filters, group: "agentKinds", values: AGENT_KINDS }),
    statuses: groupCounts({ templates, filters, group: "statuses", values: TEMPLATE_STATUSES }),
  };
}

/** One trunk's templates on the library screen. */
export interface TemplateSection {
  readonly trunk: Trunk;
  readonly templates: readonly LibraryTemplate[];
}

/** Sections in the question tree's trunk order, ready templates first; empty trunks left out. */
export function templateSections({
  templates,
}: {
  templates: readonly LibraryTemplate[];
}): TemplateSection[] {
  return TRUNKS.map((trunk) => ({
    trunk,
    templates: templates
      .filter((template) => template.trunk === trunk)
      .toSorted((a, b) => Number(a.status !== "ready") - Number(b.status !== "ready")),
  })).filter((section) => section.templates.length > 0);
}

const QUERY_KEYS = {
  search: "q",
  trunks: "trunk",
  agentKinds: "agent",
  statuses: "status",
} as const satisfies Record<keyof TemplateLibraryFilters, string>;

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
): TemplateLibraryFilters {
  return {
    search: query[QUERY_KEYS.search] ?? "",
    trunks: pickedFrom({ raw: query[QUERY_KEYS.trunks], values: TRUNKS }),
    agentKinds: pickedFrom({ raw: query[QUERY_KEYS.agentKinds], values: AGENT_KINDS }),
    statuses: pickedFrom({ raw: query[QUERY_KEYS.statuses], values: TEMPLATE_STATUSES }),
  };
}

/** The address query for a view, over the rest of the query; an empty field leaves its key out. */
export function templateFiltersQuery({
  query,
  filters,
}: {
  query: Readonly<Record<string, string | undefined>>;
  filters: TemplateLibraryFilters;
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

/**
 * One filter over the dashboards catalogue: the search, the one picked trunk, their counts and
 * the sections, shared by the templates finder and "Add a widget". The agent type picks which
 * items are in play at all, so it is the caller's pool. @see dashboards-finder.feature
 */

import {
  AGENT_KIND_LABELS,
  type AgentKind,
  TRUNKS,
  type Trunk,
} from "../catalogue/model/catalogue-labels.ts";

/** What the search and the chips read from a template or a widget. */
export interface CatalogueItem {
  readonly trunk: Trunk;
  /** Every word the search box matches, lower-cased. */
  readonly searchText: string;
}

/** What the member narrowed the list to; an unset chip means every value. */
export interface CatalogueFilters {
  readonly search: string;
  readonly trunk?: Trunk;
  readonly agentKind?: AgentKind;
}

export const NO_CATALOGUE_FILTERS: CatalogueFilters = { search: "" };

/** An item's search text: its own words, then each agent kind by id and by name. */
export function catalogueSearchText({
  words,
  agentKinds,
}: {
  words: readonly string[];
  agentKinds: readonly AgentKind[];
}): string {
  return [...words, ...agentKinds.flatMap((kind) => [kind, AGENT_KIND_LABELS[kind]])]
    .join("\n")
    .toLowerCase();
}

function matchesSearch({ item, search }: { item: CatalogueItem; search: string }): boolean {
  const typed = search.trim().toLowerCase();
  return !typed || item.searchText.includes(typed);
}

/** The items the search and the trunk chip leave. */
export function filterCatalogue<Item extends CatalogueItem>({
  items,
  filters,
}: {
  items: readonly Item[];
  filters: Pick<CatalogueFilters, "search" | "trunk">;
}): Item[] {
  return items.filter(
    (item) =>
      matchesSearch({ item, search: filters.search }) &&
      (!filters.trunk || item.trunk === filters.trunk),
  );
}

/** Each trunk chip's count under the search: what picking it would show. */
export interface TrunkCounts {
  readonly all: number;
  readonly byTrunk: Readonly<Record<Trunk, number>>;
}

export function trunkCounts({
  items,
  search,
}: {
  items: readonly CatalogueItem[];
  search: string;
}): TrunkCounts {
  const open = items.filter((item) => matchesSearch({ item, search }));
  const byTrunk = Object.fromEntries(
    TRUNKS.map((trunk) => [trunk, open.filter((item) => item.trunk === trunk).length]),
  ) as Record<Trunk, number>;
  return { all: open.length, byTrunk };
}

/** The items under one heading. */
export interface CatalogueSection<Key, Item extends CatalogueItem> {
  readonly key: Key;
  readonly items: readonly Item[];
}

/** Sections in the order of `keys`, each in item order; empty sections left out. */
export function catalogueSections<Key, Item extends CatalogueItem>({
  items,
  keys,
  keyOf,
}: {
  items: readonly Item[];
  keys: readonly Key[];
  keyOf: (item: Item) => Key;
}): CatalogueSection<Key, Item>[] {
  return keys
    .map((key) => ({ key, items: items.filter((item) => keyOf(item) === key) }))
    .filter((section) => section.items.length > 0);
}

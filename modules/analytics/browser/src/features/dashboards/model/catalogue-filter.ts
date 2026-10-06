/**
 * One filter over the dashboards catalogue: the search, the trunk, agent kind and readiness
 * chips, their counts and the sections. The templates library and the "Add a block" picker
 * both narrow with it, so a chip means the same on either. @see dashboards-v2.feature
 */

import {
  AGENT_KIND_LABELS,
  AGENT_KINDS,
  type AgentKind,
  TRUNKS,
  type Trunk,
} from "../catalogue/model/catalogue-labels.ts";

export const CATALOGUE_STATUSES = ["ready", "coming-soon"] as const;
/** Whether the member can use the item today. */
export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number];

export const CATALOGUE_STATUS_LABELS: Readonly<Record<CatalogueStatus, string>> = {
  ready: "Ready",
  "coming-soon": "Coming soon",
};

/** What the search and the chips read from a template or a widget. */
export interface CatalogueItem {
  readonly trunk: Trunk;
  /** The agent kinds the item is made for; empty when it suits every kind. */
  readonly agentKinds: readonly AgentKind[];
  readonly status: CatalogueStatus;
  /** Every word the search box matches, lower-cased. */
  readonly searchText: string;
}

/** What the member narrowed the list to; an empty group means every value. */
export interface CatalogueFilters {
  readonly search: string;
  readonly trunks: readonly Trunk[];
  readonly agentKinds: readonly AgentKind[];
  readonly statuses: readonly CatalogueStatus[];
}

export const NO_CATALOGUE_FILTERS: CatalogueFilters = {
  search: "",
  trunks: [],
  agentKinds: [],
  statuses: [],
};

/** A chip group: the filter field it writes. */
type FilterGroup = Exclude<keyof CatalogueFilters, "search">;

const FILTER_GROUPS: readonly FilterGroup[] = ["trunks", "agentKinds", "statuses"];

/** One chip value, named with its group: what a card or row label toggles. */
export type CatalogueFilterPick =
  | { readonly group: "trunks"; readonly value: Trunk }
  | { readonly group: "agentKinds"; readonly value: AgentKind }
  | { readonly group: "statuses"; readonly value: CatalogueStatus };

/** The picked values with `value` added, or taken out when it was already picked. */
export function togglePicked<Value extends string>({
  picked,
  value,
}: {
  picked: readonly Value[];
  value: Value;
}): Value[] {
  return picked.includes(value) ? picked.filter((each) => each !== value) : [...picked, value];
}

/** The filters with one chip flipped, as clicking its chip or a label for it does. */
export function toggleCatalogueFilter({
  filters,
  pick,
}: {
  filters: CatalogueFilters;
  pick: CatalogueFilterPick;
}): CatalogueFilters {
  switch (pick.group) {
    case "trunks":
      return { ...filters, trunks: togglePicked({ picked: filters.trunks, value: pick.value }) };
    case "agentKinds":
      return {
        ...filters,
        agentKinds: togglePicked({ picked: filters.agentKinds, value: pick.value }),
      };
    case "statuses":
      return {
        ...filters,
        statuses: togglePicked({ picked: filters.statuses, value: pick.value }),
      };
  }
}

/** Whether a chip is picked, so a label for it can show it is on. */
export function isPicked({
  filters,
  pick,
}: {
  filters: CatalogueFilters;
  pick: CatalogueFilterPick;
}): boolean {
  return (filters[pick.group] as readonly string[]).includes(pick.value);
}

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

/** Whether an item passes one chip group; an empty pick passes every item. */
function passesGroup({
  item,
  group,
  picked,
}: {
  item: CatalogueItem;
  group: FilterGroup;
  picked: readonly string[];
}): boolean {
  if (picked.length === 0) return true;
  switch (group) {
    case "trunks":
      return picked.includes(item.trunk);
    case "agentKinds":
      return item.agentKinds.length === 0 || item.agentKinds.some((kind) => picked.includes(kind));
    case "statuses":
      return picked.includes(item.status);
  }
}

function matches({
  item,
  filters,
  except,
}: {
  item: CatalogueItem;
  filters: CatalogueFilters;
  except?: FilterGroup;
}): boolean {
  const search = filters.search.trim().toLowerCase();
  if (search && !item.searchText.includes(search)) return false;
  return FILTER_GROUPS.every(
    (group) => group === except || passesGroup({ item, group, picked: filters[group] }),
  );
}

/** The items the search and chips leave: any chip within a group, every group together. */
export function filterCatalogue<Item extends CatalogueItem>({
  items,
  filters,
}: {
  items: readonly Item[];
  filters: CatalogueFilters;
}): Item[] {
  return items.filter((item) => matches({ item, filters }));
}

/** One group's counts: "All", and each chip, with the search and the other groups applied. */
export interface CatalogueGroupCounts<Value extends string> {
  readonly all: number;
  readonly byValue: Readonly<Record<Value, number>>;
}

export interface CatalogueChipCounts {
  readonly trunks: CatalogueGroupCounts<Trunk>;
  readonly agentKinds: CatalogueGroupCounts<AgentKind>;
  readonly statuses: CatalogueGroupCounts<CatalogueStatus>;
}

function groupCounts<Value extends string>({
  items,
  filters,
  group,
  values,
}: {
  items: readonly CatalogueItem[];
  filters: CatalogueFilters;
  group: FilterGroup;
  values: readonly Value[];
}): CatalogueGroupCounts<Value> {
  const open = items.filter((item) => matches({ item, filters, except: group }));
  const countFor = (value: Value) =>
    open.filter((item) => passesGroup({ item, group, picked: [value] })).length;
  const byValue = Object.fromEntries(values.map((value) => [value, countFor(value)]));
  return { all: open.length, byValue: byValue as Record<Value, number> };
}

/** Every chip's count, faceted: a group never narrows its own counts. */
export function catalogueChipCounts({
  items,
  filters,
}: {
  items: readonly CatalogueItem[];
  filters: CatalogueFilters;
}): CatalogueChipCounts {
  return {
    trunks: groupCounts({ items, filters, group: "trunks", values: TRUNKS }),
    agentKinds: groupCounts({ items, filters, group: "agentKinds", values: AGENT_KINDS }),
    statuses: groupCounts({ items, filters, group: "statuses", values: CATALOGUE_STATUSES }),
  };
}

/** The items under one heading. */
export interface CatalogueSection<Key, Item extends CatalogueItem> {
  readonly key: Key;
  readonly items: readonly Item[];
}

/** Sections in the order of `keys`, ready items first in each; empty sections left out. */
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
    .map((key) => ({
      key,
      items: items
        .filter((item) => keyOf(item) === key)
        .toSorted((a, b) => Number(a.status !== "ready") - Number(b.status !== "ready")),
    }))
    .filter((section) => section.items.length > 0);
}

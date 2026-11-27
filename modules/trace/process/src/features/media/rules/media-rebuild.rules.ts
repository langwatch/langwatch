/**
 * Clone-on-write rebuild of a value along the paths of its replaced media sites only: untouched
 * branches keep their identity, and a nested JSON string is re-serialised only when a site in it
 * changed.
 */

import type { MediaPathSegment, MediaSite } from "./media-sites.rules.ts";

/** A site whose media was stored, and what now stands in its place. */
export type ReplacedMediaSite = MediaSite & Readonly<{ replacement: unknown }>;

function groupBySegment<K extends number | string>(
  sites: ReplacedMediaSite[],
  segIndex: number,
  read: (seg: MediaPathSegment) => K | undefined,
): Map<K, ReplacedMediaSite[]> {
  const grouped = new Map<K, ReplacedMediaSite[]>();
  for (const site of sites) {
    const key = read(site.path[segIndex]!);
    if (key === undefined) continue;
    const group = grouped.get(key) ?? [];
    group.push(site);
    grouped.set(key, group);
  }

  return grouped;
}

function rebuildArray(value: unknown[], sites: ReplacedMediaSite[], segIndex: number): unknown[] {
  const out = [...value];
  const byIndex = groupBySegment(sites, segIndex, (seg) =>
    "index" in seg ? seg.index : undefined,
  );
  for (const [index, group] of byIndex) {
    out[index] = rebuildAt(out[index], group, segIndex + 1);
  }

  return out;
}

function rebuildObject(
  value: Record<string, unknown>,
  sites: ReplacedMediaSite[],
  segIndex: number,
): Record<string, unknown> {
  const out = { ...value };
  const byKey = groupBySegment(sites, segIndex, (seg) => ("key" in seg ? seg.key : undefined));
  for (const [key, group] of byKey) {
    out[key] = rebuildAt(out[key], group, segIndex + 1);
  }

  return out;
}

function rebuildAt(value: unknown, sites: ReplacedMediaSite[], segIndex: number): unknown {
  const direct = sites.find((site) => site.path.length === segIndex);
  if (direct) return direct.replacement;

  if (typeof value === "string") {
    const inner = sites.filter((site) => "json" in site.path[segIndex]!);
    if (inner.length === 0) return value;
    const parsed: unknown = JSON.parse(value);

    return JSON.stringify(rebuildAt(parsed, inner, segIndex + 1));
  }

  if (Array.isArray(value)) return rebuildArray(value, sites, segIndex);
  if (typeof value === "object" && value !== null) {
    return rebuildObject(value as Record<string, unknown>, sites, segIndex);
  }

  return value;
}

/** `value` with each replaced site swapped in, cloned only along the paths that changed. */
export function rebuildWithReplacements(value: unknown, sites: ReplacedMediaSite[]): unknown {
  return rebuildAt(value, sites, 0);
}

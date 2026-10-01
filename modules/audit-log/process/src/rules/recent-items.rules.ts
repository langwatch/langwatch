import type { AuditLogJsonValue, RecentItemType } from "@langwatch/audit-log-contract";
import type { Instant } from "@langwatch/time";

import type { RecentTouch } from "../repositories/recent-touch.repository.ts";

export const RECENT_ACTION_TYPES: readonly (readonly [prefix: string, type: RecentItemType])[] = [
  ["prompts.", "prompt"],
  ["workflow.", "workflow"],
  ["dataset.", "dataset"],
  ["datasetRecord.", "dataset"],
  ["monitors.", "evaluation"],
  ["annotation.", "annotation"],
  ["scenarios.", "simulation"],
];

export const RECENT_ACTION_PREFIXES: readonly string[] = RECENT_ACTION_TYPES.map(
  ([prefix]) => prefix,
);

const ENTITY_ARGUMENTS: Record<RecentItemType, readonly string[]> = {
  prompt: ["configId"],
  workflow: ["workflowId"],
  dataset: ["datasetId"],
  evaluation: ["checkId", "monitorId"],
  annotation: ["annotationQueueId"],
  simulation: ["scenarioSetId"],
};

/** Rows read per strip slot: dedup and hidden entities eat into what the trail answers. */
export function deriveTouchFetchLimit(limit: number): number {
  return limit * 3;
}

export type RecentEntity = {
  type: RecentItemType;
  id: string;
  touchedAt: Instant;
};

/** The newest touch of each entity, in trail order, capped at the strip's size. */
export function pickRecentEntities({
  touches,
  limit,
}: {
  touches: readonly RecentTouch[];
  limit: number;
}): RecentEntity[] {
  const entities = new Map<string, RecentEntity>();

  for (const touch of touches) {
    const type = RECENT_ACTION_TYPES.find(([prefix]) => touch.action.startsWith(prefix))?.[1];
    if (type === undefined) continue;

    const [id] = findStringArguments(touch.args, ENTITY_ARGUMENTS[type]);
    if (id === undefined) continue;

    const key = `${type}:${id}`;
    if (!entities.has(key)) entities.set(key, { type, id, touchedAt: touch.createdAt });
  }

  return [...entities.values()].slice(0, limit);
}

function findStringArguments(args: AuditLogJsonValue, names: readonly string[]): string[] {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return [];

  return names.flatMap((name) => {
    const value = args[name];
    return typeof value === "string" ? [value] : [];
  });
}

export function deriveRecentItemHref({
  type,
  projectSlug,
  id,
  queueSlug,
}: {
  type: Exclude<RecentItemType, "simulation">;
  projectSlug: string;
  id: string;
  queueSlug?: string;
}): string {
  switch (type) {
    case "prompt":
      return `/${projectSlug}/prompts?prompt=${id}`;
    case "workflow":
      return `/${projectSlug}/studio/${id}`;
    case "dataset":
      return `/${projectSlug}/datasets/${id}`;
    case "evaluation":
      return `/${projectSlug}/online-evaluations`;
    case "annotation":
      return `/${projectSlug}/annotations/${queueSlug ?? id}`;
  }
}

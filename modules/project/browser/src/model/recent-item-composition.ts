import type { RecentItemType } from "@langwatch/audit-log-contract";

/** The touch types an owner can name; a simulation touch never renders. */
export type NamedRecentItemType = Exclude<RecentItemType, "simulation">;

/** A live entity an owner's list read answered; the caller leaves archived and deleted ones out. */
export type RecentItemOwnerEntity = Readonly<{ id: string; name: string; slug?: string }>;

export type RecentItemOwnerEntities = Partial<
  Record<NamedRecentItemType, readonly RecentItemOwnerEntity[]>
>;

/** The owner lists the strip needs: one per type among the touches, none for simulations. */
export function recentItemTypesToResolve({
  touches,
}: {
  touches: readonly Readonly<{ type: RecentItemType }>[];
}): ReadonlySet<NamedRecentItemType> {
  const types = new Set<NamedRecentItemType>();
  for (const touch of touches) {
    if (touch.type !== "simulation") types.add(touch.type);
  }
  return types;
}

/** Names and links each touch from its owner's list, in touch order; unanswered touches drop. */
export function composeRecentItems<TTouch extends Readonly<{ id: string; type: RecentItemType }>>({
  touches,
  projectSlug,
  entities,
}: {
  touches: readonly TTouch[];
  projectSlug: string;
  entities: RecentItemOwnerEntities;
}): (TTouch & { name: string; href: string })[] {
  return touches.flatMap((touch) => {
    if (touch.type === "simulation") return [];
    const entity = entities[touch.type]?.find((candidate) => candidate.id === touch.id);
    if (entity === undefined) return [];

    const href = deriveRecentItemHref({
      type: touch.type,
      projectSlug,
      id: entity.id,
      slug: entity.slug,
    });
    return [{ ...touch, name: entity.name, href }];
  });
}

export function deriveRecentItemHref({
  type,
  projectSlug,
  id,
  slug,
}: {
  type: NamedRecentItemType;
  projectSlug: string;
  id: string;
  slug?: string;
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
      return `/${projectSlug}/annotations/${slug ?? id}`;
  }
}

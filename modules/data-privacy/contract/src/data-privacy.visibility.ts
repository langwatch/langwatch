import type { Disposition, ResolvedAudience } from "./data-privacy.ts";

export interface ViewerFacts {
  isAdmin: boolean;
  isMember: boolean;
  isMemberRole: boolean;
  isViewer: boolean;
  isProjectOwner: boolean;
  groupIds: string[];
}
export interface EffectiveRestriction {
  disposition: Disposition;
  audience: ResolvedAudience;
}
/** The project permissions a viewer's role is read from, for every reader of captured content. */
export type ViewerRolePermission = "traces:view" | "traces:update" | "project:manage";

/** Admin is `project:manage`, never `project:update`: a Member holds that too. */
export function viewerFactsFrom({
  held,
  isProjectOwner,
  groupIds,
}: {
  held: Readonly<Record<ViewerRolePermission, boolean>>;
  isProjectOwner: boolean;
  groupIds: string[];
}): ViewerFacts {
  const isMember = held["traces:view"];
  const isAdmin = held["project:manage"];
  const isMemberRole = held["traces:update"] && !isAdmin;
  return {
    isAdmin,
    isMember,
    isMemberRole,
    isViewer: isMember && !isAdmin && !isMemberRole,
    isProjectOwner,
    groupIds,
  };
}

/** Asks each role permission once, so every reader asks the same ones. */
export async function askViewerRolePermissions(
  ask: (permission: ViewerRolePermission) => Promise<boolean>,
): Promise<Record<ViewerRolePermission, boolean>> {
  const [view, update, manage] = await Promise.all([
    ask("traces:view"),
    ask("traces:update"),
    ask("project:manage"),
  ]);
  return { "traces:view": view, "traces:update": update, "project:manage": manage };
}

/**
 * Whether the viewer owns every project whose policy governs a read: a folded owner-only audience
 * may be another project's. Fail-closed: no project, no owner or a lookup that throws is not.
 */
export async function ownsEveryGovernedProject({
  userId,
  projectIds,
  ownerOf,
  onLookupFailure,
}: {
  userId: string | undefined;
  projectIds: readonly string[];
  ownerOf: (projectId: string) => Promise<string | null | undefined>;
  onLookupFailure: (error: unknown) => void;
}): Promise<boolean> {
  if (userId === undefined || projectIds.length === 0) return false;
  try {
    const owners = await Promise.all(projectIds.map((projectId) => ownerOf(projectId)));
    return owners.every((owner) => owner === userId);
  } catch (error) {
    onLookupFailure(error);
    return false;
  }
}

export function isContentVisible(eff: EffectiveRestriction, viewer: ViewerFacts): boolean {
  if (!viewer.isMember && !viewer.isProjectOwner) return false;
  if (eff.disposition === "drop") return false;
  if (eff.disposition === "capture") return viewer.isMember;
  const audience = eff.audience;
  if (audience.allMembers && viewer.isMember) return true;
  if (audience.admins && viewer.isAdmin) return true;
  if (audience.members && viewer.isMemberRole) return true;
  if (audience.viewers && viewer.isViewer) return true;
  if (audience.projectOwner && viewer.isProjectOwner) return true;
  return audience.groupIds.some((id) => viewer.groupIds.includes(id));
}
export function isContentVisibleToPublic(eff: EffectiveRestriction): boolean {
  return eff.disposition === "capture";
}
export function needsAudienceFacts(eff: EffectiveRestriction): boolean {
  return eff.disposition === "restrict" && eff.audience.groupIds.length > 0;
}
export function describeAudience(
  audience: ResolvedAudience,
  names: { groups: Record<string, string> },
): string {
  const parts: string[] = [];
  if (audience.allMembers) parts.push("All members");
  if (audience.admins) parts.push("Admins");
  if (audience.members) parts.push("Members");
  if (audience.viewers) parts.push("Viewers");
  if (audience.projectOwner) parts.push("the project owner");
  for (const id of audience.groupIds) parts.push(names.groups[id] ?? "a group");
  return parts.length > 0 ? parts.join(", ") : "no one";
}

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
export type HeldRolePermissions = Readonly<Record<ViewerRolePermission, boolean>>;

/** Admin is `project:manage`, never `project:update`: a Member holds that too. */
function roleFrom(held: HeldRolePermissions): Omit<ViewerFacts, "isProjectOwner" | "groupIds"> {
  const isMember = held["traces:view"];
  const isAdmin = held["project:manage"];
  const isMemberRole = held["traces:update"] && !isAdmin;
  return { isAdmin, isMember, isMemberRole, isViewer: isMember && !isAdmin && !isMemberRole };
}

/**
 * `held` is the read's own project, whose proof entitles membership across the rest (ADR-177).
 * A role audience opens only where the role holds at every project in `heldElsewhere` too.
 */
export function viewerFactsFrom({
  held,
  heldElsewhere,
  isProjectOwner,
  groupIds,
}: {
  held: HeldRolePermissions;
  heldElsewhere: readonly HeldRolePermissions[];
  isProjectOwner: boolean;
  groupIds: string[];
}): ViewerFacts {
  const roles = [held, ...heldElsewhere].map(roleFrom);
  const everywhere = (role: "isAdmin" | "isMemberRole" | "isViewer") =>
    roles.every((at) => at[role]);
  return {
    isAdmin: everywhere("isAdmin"),
    isMember: held["traces:view"],
    isMemberRole: everywhere("isMemberRole"),
    isViewer: everywhere("isViewer"),
    isProjectOwner,
    groupIds,
  };
}

/** Asks each role permission once, so every reader asks the same ones. */
export async function askViewerRolePermissions(
  ask: (permission: ViewerRolePermission) => Promise<boolean>,
): Promise<HeldRolePermissions> {
  const [view, update, manage] = await Promise.all([
    ask("traces:view"),
    ask("traces:update"),
    ask("project:manage"),
  ]);
  return { "traces:view": view, "traces:update": update, "project:manage": manage };
}

/** Whether a restriction opens to a role, so the role at the read's other projects matters. */
export function needsRoleEverywhere(eff: EffectiveRestriction): boolean {
  const { audience } = eff;
  return (
    eff.disposition === "restrict" && (audience.admins || audience.members || audience.viewers)
  );
}

/** Whether ownership can change what this viewer sees: an owner audience or the non-member gate. */
export function needsOwnerFact({
  restrictions,
  isMember,
}: {
  restrictions: readonly EffectiveRestriction[];
  isMember: boolean;
}): boolean {
  return (
    !isMember ||
    restrictions.some((eff) => eff.disposition === "restrict" && eff.audience.projectOwner)
  );
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
/** ADR-208: a key sees restricted content as Admins do, and only where the audience names it. */
export function isContentVisibleToKey(
  eff: EffectiveRestriction,
  key: { apiKeyId: string },
): boolean {
  if (eff.disposition !== "restrict") return isContentVisibleToPublic(eff);
  const { audience } = eff;
  const adminsSee = audience.admins || audience.allMembers;
  return adminsSee && audience.apiKeyIds.includes(key.apiKeyId);
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

import type { Disposition, ResolvedAudience } from "./data-privacy";

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

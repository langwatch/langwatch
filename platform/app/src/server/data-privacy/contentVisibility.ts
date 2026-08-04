import type { Disposition, ResolvedAudience } from "./dataPrivacy.types";

/**
 * Read-time content visibility for the scoped data-privacy policy. A `restrict`
 * category stores the content but hides it from anyone outside its audience;
 * this module decides, for one viewer, whether a category is visible and (when
 * not) who it is visible to, so the trace view can explain the redaction.
 */

/** What we know about the viewer for an audience check. */
export interface ViewerFacts {
  isAdmin: boolean;
  /** Has project access of any kind (any role on the project's team). */
  isMember: boolean;
  /** Holds the built-in MEMBER role on the project's team. */
  isMemberRole: boolean;
  /** Holds the built-in VIEWER role on the project's team. */
  isViewer: boolean;
  /** Owns the (personal) project the trace belongs to. */
  isProjectOwner: boolean;
  groupIds: string[];
}

/**
 * The resolved disposition + audience a viewer is checked against. Structurally
 * a `ResolvedCategory`, kept as its own name for the read-side call sites.
 */
export interface EffectiveRestriction {
  disposition: Disposition;
  audience: ResolvedAudience;
}

/**
 * Whether a signed-in viewer may read content under an effective restriction.
 * Non-members see nothing; dropped content is not stored; captured content is
 * visible to every member; a restrict audience matches everyone with access
 * (all members), the standard role groups (admins, members, viewers), the
 * project owner, or any of the viewer's groups.
 */
export function isContentVisible(
  eff: EffectiveRestriction,
  viewer: ViewerFacts,
): boolean {
  if (!viewer.isMember && !viewer.isProjectOwner) return false;
  if (eff.disposition === "drop") return false;
  if (eff.disposition === "capture") return viewer.isMember;
  const audience = eff.audience;
  if (audience.allMembers && viewer.isMember) return true;
  if (audience.admins && viewer.isAdmin) return true;
  if (audience.members && viewer.isMemberRole) return true;
  if (audience.viewers && viewer.isViewer) return true;
  if (audience.projectOwner && viewer.isProjectOwner) return true;
  if (audience.groupIds.some((id) => viewer.groupIds.includes(id))) return true;
  return false;
}

/** A public (no-session) viewer may read only captured content. */
export function isContentVisibleToPublic(eff: EffectiveRestriction): boolean {
  return eff.disposition === "capture";
}

/**
 * Whether deciding this restriction needs the viewer's group memberships (i.e.
 * the audience names specific groups). Admin/viewer/owner-only and no-one
 * restrictions are decided from facts the read path already holds, so it can
 * skip the extra membership lookups in the common cases.
 */
export function needsAudienceFacts(eff: EffectiveRestriction): boolean {
  return eff.disposition === "restrict" && eff.audience.groupIds.length > 0;
}

/**
 * A human label for who may see a restricted category, for the redaction
 * placeholder. Group ids are mapped to names by the caller (it holds the
 * prisma client); unknown ids fall back to a generic word. An empty audience
 * reads as "no one".
 */
export function describeAudience(
  audience: ResolvedAudience,
  names: {
    groups: Record<string, string>;
  },
): string {
  const parts: string[] = [];
  if (audience.allMembers) parts.push("All members");
  if (audience.admins) parts.push("Admins");
  if (audience.members) parts.push("Members");
  if (audience.viewers) parts.push("Viewers");
  if (audience.projectOwner) parts.push("the project owner");
  for (const id of audience.groupIds) {
    parts.push(names.groups[id] ?? "a group");
  }
  return parts.length > 0 ? parts.join(", ") : "no one";
}

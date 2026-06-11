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
  isMember: boolean;
  groupIds: string[];
  departmentId: string | null;
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
 * visible to every member; a restrict audience matches admins, all-members, any
 * of the viewer's groups, or the viewer's department.
 */
export function isContentVisible(
  eff: EffectiveRestriction,
  viewer: ViewerFacts,
): boolean {
  if (!viewer.isMember) return false;
  if (eff.disposition === "drop") return false;
  if (eff.disposition === "capture") return true;
  const audience = eff.audience;
  if (audience.admins && viewer.isAdmin) return true;
  if (audience.allMembers && viewer.isMember) return true;
  if (audience.groupIds.some((id) => viewer.groupIds.includes(id))) return true;
  if (
    viewer.departmentId != null &&
    audience.departmentIds.includes(viewer.departmentId)
  ) {
    return true;
  }
  return false;
}

/** A public (no-session) viewer may read only captured content. */
export function isContentVisibleToPublic(eff: EffectiveRestriction): boolean {
  return eff.disposition === "capture";
}

/**
 * Whether deciding this restriction needs the viewer's groups/department (i.e.
 * the audience names specific groups or departments). Admins-only and no-one
 * restrictions are decided from the admin flag alone, so the read path can skip
 * the extra membership lookups in the common cases.
 */
export function needsAudienceFacts(eff: EffectiveRestriction): boolean {
  return (
    eff.disposition === "restrict" &&
    (eff.audience.groupIds.length > 0 || eff.audience.departmentIds.length > 0)
  );
}

/**
 * A human label for who may see a restricted category, for the redaction
 * placeholder. Group and department ids are mapped to names by the caller (it
 * holds the prisma client); unknown ids fall back to a generic word. An empty
 * audience reads as "no one".
 */
export function describeAudience(
  audience: ResolvedAudience,
  names: {
    groups: Record<string, string>;
    departments: Record<string, string>;
  },
): string {
  const parts: string[] = [];
  if (audience.admins) parts.push("Admins");
  if (audience.allMembers) parts.push("All members");
  for (const id of audience.groupIds) {
    parts.push(names.groups[id] ?? "a group");
  }
  for (const id of audience.departmentIds) {
    parts.push(names.departments[id] ?? "a department");
  }
  return parts.length > 0 ? parts.join(", ") : "no one";
}

import {
  EMPTY_AUDIENCE,
  type Disposition,
  type ResolvedAudience,
  type ResolvedCategory,
} from "./dataPrivacy.types";

/**
 * Read-time content visibility for the scoped data-privacy policy. A `restrict`
 * category stores the content but hides it from anyone outside its audience;
 * this module decides, for one viewer, whether a category is visible and (when
 * not) who it is visible to, so the trace view can explain the redaction.
 *
 * During the migration window the project's legacy
 * `capturedInput/OutputVisibility` enum still applies wherever the new policy
 * has not set an explicit disposition — see `effectiveCategoryRestriction`.
 */

/** The legacy per-project visibility enum, reconciled below. */
export type LegacyVisibility =
  | "VISIBLE_TO_ALL"
  | "VISIBLE_TO_ADMIN"
  | "REDACTED_TO_ALL";

/** What we know about the viewer for an audience check. */
export interface ViewerFacts {
  isAdmin: boolean;
  isMember: boolean;
  groupIds: string[];
  departmentId: string | null;
}

export interface EffectiveRestriction {
  disposition: Disposition;
  audience: ResolvedAudience;
}

const ADMINS_ONLY: ResolvedAudience = {
  admins: true,
  allMembers: false,
  groupIds: [],
  departmentIds: [],
};

/**
 * Reconcile a resolved category with the project's legacy visibility enum. An
 * explicit policy (restrict or drop) always wins; at the platform default
 * ("capture") we honor the legacy field so a project that set VISIBLE_TO_ADMIN
 * or REDACTED_TO_ALL keeps that behavior until the backfill writes a rule.
 */
export function effectiveCategoryRestriction(
  category: ResolvedCategory,
  legacy: LegacyVisibility,
): EffectiveRestriction {
  if (category.disposition !== "capture") {
    return { disposition: category.disposition, audience: category.audience };
  }
  switch (legacy) {
    case "VISIBLE_TO_ADMIN":
      return { disposition: "restrict", audience: { ...ADMINS_ONLY } };
    case "REDACTED_TO_ALL":
      return { disposition: "restrict", audience: { ...EMPTY_AUDIENCE } };
    default:
      return { disposition: "capture", audience: { ...EMPTY_AUDIENCE } };
  }
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
  names: { groups: Record<string, string>; departments: Record<string, string> },
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

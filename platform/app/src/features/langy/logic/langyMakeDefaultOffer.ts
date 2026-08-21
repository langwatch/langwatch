import type { ScopeTier } from "~/server/scopes/scope.types";

/**
 * Whether picking a model in the composer earns the "make it the default?"
 * ask, and exactly what a yes would write.
 *
 * The offer follows the default it would replace: it goes to the SCOPE the
 * current Langy default is configured at, and only to a user who can manage
 * that scope — an org-level default asks an org admin, a team- or
 * project-level one asks whoever manages that team or project. No configured
 * default (the resolver inferred one from an enabled provider) means there is
 * nothing to move, so no ask. Picking the default itself asks nothing.
 *
 * Pure decision, no I/O: the panel feeds it the resolved default it already
 * holds and the permission answers, and maps the returned plan onto the
 * matching mutation (`setFeatureOverrideForScope` for a feature-level
 * default, `setRoleAssignmentForScope` for a role-level one).
 */
export interface MakeDefaultWritePlan {
  kind: "feature-override" | "role-default";
  scopeType: ScopeTier;
  scopeId: string;
  /** The scope word the dialog's copy names. */
  scopeLabel: "organization" | "team" | "project";
  model: string;
}

export function makeDefaultOffer({
  picked,
  resolvedDefault,
  canManage,
  scopeIds,
}: {
  /** The model the user just picked, `provider/model`. */
  picked: string;
  /** What `getResolvedDefault` answered for Langy's feature key. */
  resolvedDefault: {
    model: string;
    source: string;
    scope: string | null;
  } | null;
  /** The caller's manage rights, one per scope the default could live at. */
  canManage: { organization: boolean; team: boolean; project: boolean };
  scopeIds: {
    organizationId: string | null;
    teamId: string | null;
    projectId: string | null;
  };
}): MakeDefaultWritePlan | null {
  if (!resolvedDefault?.scope) return null;
  if (picked === resolvedDefault.model) return null;

  const kind =
    resolvedDefault.source === "feature_override"
      ? ("feature-override" as const)
      : ("role-default" as const);

  switch (resolvedDefault.scope) {
    case "organization":
      if (!canManage.organization || !scopeIds.organizationId) return null;
      return {
        kind,
        scopeType: "ORGANIZATION",
        scopeId: scopeIds.organizationId,
        scopeLabel: "organization",
        model: picked,
      };
    case "team":
      if (!canManage.team || !scopeIds.teamId) return null;
      return {
        kind,
        scopeType: "TEAM",
        scopeId: scopeIds.teamId,
        scopeLabel: "team",
        model: picked,
      };
    case "project":
      if (!canManage.project || !scopeIds.projectId) return null;
      return {
        kind,
        scopeType: "PROJECT",
        scopeId: scopeIds.projectId,
        scopeLabel: "project",
        model: picked,
      };
    default:
      return null;
  }
}

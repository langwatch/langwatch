import type { ModelDefaultEffective } from "@langwatch/model-provider-contract";
import type { ScopeTier } from "../../../../model/langy-host";

/**
 * Whether picking a model in the composer earns the "make it the default?" ask, and
 * exactly what a yes would write.
 */
export interface MakeDefaultWritePlan {
  kind: "feature-override" | "role-default";
  scopeType: ScopeTier;
  scopeId: string;
  /** The scope word the dialog's copy names. */
  scopeLabel: "organization" | "team" | "project";
  model: string;
}

/**
 * The scope tier each offerable scope word writes to. Doubles as the set of
 * scope words an offer can be made for: a resolver answer outside these keys
 * has no scope to write at.
 */
const SCOPE_TIER_BY_LABEL = {
  organization: "ORGANIZATION",
  team: "TEAM",
  project: "PROJECT",
} as const satisfies Record<MakeDefaultWritePlan["scopeLabel"], ScopeTier>;

function isOfferableScope(
  scope: NonNullable<ModelDefaultEffective["scope"]>,
): scope is MakeDefaultWritePlan["scopeLabel"] {
  return scope in SCOPE_TIER_BY_LABEL;
}

export function makeDefaultOffer({
  picked,
  resolvedDefault,
  canManage,
  scopeIds,
}: {
  /** The model the user just picked, `provider/model`. */
  picked: string;
  /**
   * What `getResolvedDefault` answered for Langy's feature key, in the
   * resolver's own type: a renamed source or scope slug fails here at compile
   * time rather than turning the offer into a silent no-op.
   */
  resolvedDefault: ModelDefaultEffective | null;
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

  const scopeLabel = resolvedDefault.scope;
  if (!isOfferableScope(scopeLabel)) return null;
  if (!canManage[scopeLabel]) return null;

  const scopeId = scopeIds[`${scopeLabel}Id`];
  if (!scopeId) return null;

  return {
    kind: resolvedDefault.source === "feature_override" ? "feature-override" : "role-default",
    scopeType: SCOPE_TIER_BY_LABEL[scopeLabel],
    scopeId,
    scopeLabel,
    model: picked,
  };
}

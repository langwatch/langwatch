// The roles an organization has and who holds each, read once for the list and its drawer.

import {
  BILLING_ROLE_CARD,
  billingRoleGrantedPermissions,
  BUILTIN_ROLE_CARDS,
  builtinRoleGrantedPermissions,
  peopleHoldingBuiltinRole,
  type RoleDotPalette,
} from "../model/builtin-roles.ts";
import type { ManagedGrant } from "../model/managed-grant.ts";
import { authzApi, type RouterOutputs } from "./authz-api.ts";

export type CustomRole = RouterOutputs["role"]["getAll"][number];

/** A built-in role as the list and its drawer present it. */
export type BuiltinRoleEntry = {
  key: string;
  name: string;
  description: string;
  dot: RoleDotPalette;
  /** The line above the headline chips, or null when the role needs none. */
  lead: string | null;
  headline: readonly string[];
  permissions: readonly string[];
  /** How many people hold it, or null when that could not be read. */
  people: number | null;
};

const NO_ASSIGNMENTS: ManagedGrant[] = [];

export function useRoleCatalogue({ organizationId }: { organizationId: string }) {
  const roles = authzApi.role.getAll.useQuery({ organizationId });
  const assignments = authzApi.authz.listManagedGrants.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );
  const billingMembers = authzApi.authz.listBillingMembers.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );
  const assignmentRows = assignments.data ?? NO_ASSIGNMENTS;
  // Losing the assignments costs the counts and holders, never the roles; null is "unknown".
  const assignmentsUnavailable = assignments.isError;
  const countsPending = assignments.isLoading || assignmentsUnavailable;

  const builtin: BuiltinRoleEntry[] = [
    ...BUILTIN_ROLE_CARDS.map((card) => ({
      key: card.key,
      name: card.name,
      description: card.description,
      dot: card.dot,
      lead: card.inheritsFrom
        ? `Everything ${card.inheritsFrom} has, and`
        : "The base every other role builds on",
      headline: card.headline,
      permissions: builtinRoleGrantedPermissions(card.teamRole),
      people: countsPending
        ? null
        : peopleHoldingBuiltinRole({ bindings: assignmentRows, teamRole: card.teamRole }),
    })),
    {
      key: BILLING_ROLE_CARD.key,
      name: BILLING_ROLE_CARD.name,
      description: BILLING_ROLE_CARD.description,
      dot: BILLING_ROLE_CARD.dot,
      lead: null,
      headline: BILLING_ROLE_CARD.headline,
      permissions: billingRoleGrantedPermissions(),
      people: billingMembers.data ? billingMembers.data.length : null,
    },
  ];

  return {
    builtin,
    roles,
    /** Null when the assignments could not be read. */
    assignments: assignmentsUnavailable ? null : assignmentRows,
    assignmentsUnavailable,
    countsPending,
  };
}

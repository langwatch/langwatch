/**
 * What a team's membership edit means, worked out before anything is written: which bindings
 * a requested member list retires, changes or adds, who is left holding ADMIN once that plan
 * lands, and the order the members are shown back in. Nothing here reads or writes.
 */
import type { AuthzAccessBinding, AuthzTeamMemberBinding } from "@langwatch/authz-contract";
import {
  TeamCustomRoleRequiredError,
  type OrganizationTeamMember,
  type OrganizationTeamMemberInput,
} from "@langwatch/organization-contract";

export const TEAM_ROLE_PRIORITY = {
  ADMIN: 0,
  MEMBER: 1,
  VIEWER: 2,
  CUSTOM: 3,
} as const;

export type TeamMembershipPlan = {
  bindingIdsToRemove: string[];
  bindingsToChange: Array<{
    bindingId: string;
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
    customRoleId: string | null;
  }>;
  membersToAdd: OrganizationTeamMemberInput[];
};

export function memberTarget(member: OrganizationTeamMemberInput): {
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  customRoleId: string | null;
} {
  if (member.role.startsWith("custom:")) {
    return { role: "CUSTOM", customRoleId: member.customRoleId ?? null };
  }

  switch (member.role) {
    case "ADMIN":
    case "MEMBER":
    case "VIEWER":
      return { role: member.role, customRoleId: null };
    default:
      throw new TeamCustomRoleRequiredError();
  }
}

export function planTeamMembership(
  currentBindings: AuthzAccessBinding[],
  members: OrganizationTeamMemberInput[],
): TeamMembershipPlan {
  const byUser = new Map<string, AuthzAccessBinding[]>();
  for (const binding of currentBindings) {
    if (!binding.userId) {
      continue;
    }

    const bindings = byUser.get(binding.userId) ?? [];
    bindings.push(binding);
    byUser.set(binding.userId, bindings);
  }

  const requested = new Map(members.map((member) => [member.userId, member]));
  const plan: TeamMembershipPlan = {
    bindingIdsToRemove: [],
    bindingsToChange: [],
    membersToAdd: [],
  };
  for (const [userId, bindings] of byUser) {
    if (!requested.has(userId)) {
      plan.bindingIdsToRemove.push(...bindings.map(({ id }) => id));
    }
  }

  for (const member of members) {
    const bindings = byUser.get(member.userId) ?? [];
    if (bindings.length === 0) {
      plan.membersToAdd.push(member);
      continue;
    }

    const displayed = [...bindings].sort(
      (left, right) => TEAM_ROLE_PRIORITY[left.role] - TEAM_ROLE_PRIORITY[right.role],
    )[0]!;
    const target = memberTarget(member);
    if (displayed.role === target.role && displayed.customRoleId === target.customRoleId) {
      continue;
    }

    const targetAlreadyHeld = bindings.some(
      (binding) =>
        binding.id !== displayed.id &&
        binding.role === target.role &&
        binding.customRoleId === target.customRoleId,
    );
    if (targetAlreadyHeld) {
      plan.bindingIdsToRemove.push(displayed.id);
    } else {
      plan.bindingsToChange.push({ bindingId: displayed.id, ...target });
    }
  }

  return plan;
}

export function directAdminIdsAfterPlan(
  currentBindings: AuthzAccessBinding[],
  plan: TeamMembershipPlan,
): Set<string> {
  const removed = new Set(plan.bindingIdsToRemove);
  const changed = new Map(plan.bindingsToChange.map((binding) => [binding.bindingId, binding]));
  const administrators = new Set<string>();
  for (const binding of currentBindings) {
    if (!binding.userId || removed.has(binding.id)) {
      continue;
    }

    if ((changed.get(binding.id)?.role ?? binding.role) === "ADMIN") {
      administrators.add(binding.userId);
    }
  }

  for (const member of plan.membersToAdd) {
    if (memberTarget(member).role === "ADMIN") {
      administrators.add(member.userId);
    }
  }

  return administrators;
}

function compareNullableText(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left.localeCompare(right);
}

export function shapeTeamMembers(input: {
  teamId: string;
  bindings: AuthzTeamMemberBinding[];
  visibleEmailUserId?: string;
}): OrganizationTeamMember[] {
  const displayedByUser = new Map<string, AuthzTeamMemberBinding>();
  for (const binding of input.bindings) {
    const displayed = displayedByUser.get(binding.userId);
    if (!displayed || TEAM_ROLE_PRIORITY[binding.role] < TEAM_ROLE_PRIORITY[displayed.role]) {
      displayedByUser.set(binding.userId, binding);
    }
  }

  return [...displayedByUser.values()]
    .map((binding) => ({
      userId: binding.userId,
      teamId: input.teamId,
      role: binding.role,
      assignedRoleId: binding.customRoleId,
      assignedRole: binding.customRole,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
      user: {
        id: binding.user.id,
        name: binding.user.name,
        email:
          input.visibleEmailUserId === undefined || input.visibleEmailUserId === binding.userId
            ? binding.user.email
            : null,
        image: binding.user.image,
      },
    }))
    .sort((left, right) => {
      const byName = compareNullableText(left.user.name, right.user.name);
      if (byName !== 0) {
        return byName;
      }

      const byEmail = compareNullableText(left.user.email, right.user.email);

      return byEmail !== 0 ? byEmail : left.userId.localeCompare(right.userId);
    });
}

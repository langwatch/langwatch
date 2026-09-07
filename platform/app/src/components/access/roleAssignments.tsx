import { Badge, HStack, Text, VStack } from "@chakra-ui/react";
import { RoleBindingScopeType } from "~/generated/prisma/client";

/**
 * The words a customer reads for a role assignment.
 *
 * The engine calls these bindings, principals and scopes (ADR-092), and it
 * goes on calling them that: renaming a table for the sake of a screen is how
 * a codebase ends up with two vocabularies for one idea. But nobody outside
 * this building says "binding" — every identity product a customer has used
 * says a role is ASSIGNED to somebody ON something — so the screen says that,
 * and the translation happens here, once, rather than in the copy of every
 * page that shows an assignment.
 *
 * Scopes are spelled out in full for the same reason: "Org" and "🏢" both ask
 * the reader to decode a label whose whole job is to be unambiguous.
 */
export const ROLE_ASSIGNMENT_WORDS = {
  /** What the page and the tab are called. */
  plural: "Role assignments",
  /** The action that creates one. */
  create: "Assign role",
  /** The action that removes one. */
  remove: "Remove assignment",
  /** The column that holds a person or a group. */
  principalColumn: "Member or group",
} as const;

/** "Organization", "Team Platform", "Project Checkout". */
export function scopeLabel({
  scopeType,
  scopeName,
}: {
  scopeType: RoleBindingScopeType;
  scopeName: string | null;
}): string {
  if (scopeType === RoleBindingScopeType.ORGANIZATION) return "Organization";
  const kind = scopeType === RoleBindingScopeType.TEAM ? "Team" : "Project";
  // A scope whose name did not resolve says its kind and stops, rather than
  // showing the reader an identifier they cannot act on.
  return scopeName ? `${kind} ${scopeName}` : kind;
}

/** Colour by how much the role can do, not by which one it happens to be. */
export function roleTone(role: string): string {
  if (role === "ADMIN") return "red";
  if (role === "MEMBER") return "blue";
  if (role === "VIEWER") return "gray";
  return "purple";
}

/** One assignment, as a sentence: this role, on this scope. */
export interface RoleAssignmentView {
  id: string;
  role: string;
  customRoleName: string | null;
  scopeType: RoleBindingScopeType;
  scopeName: string | null;
  /** The group that carries it, when the person holds it through one. */
  groupName?: string | null;
}

export function RoleAssignment({
  assignment,
}: {
  assignment: RoleAssignmentView;
}) {
  return (
    <HStack gap={1} fontSize="xs" flexWrap="wrap">
      <Badge colorPalette={roleTone(assignment.role)} size="sm">
        {assignment.customRoleName ?? assignment.role}
      </Badge>
      <Text color="fg.muted">on</Text>
      <Badge colorPalette="purple" size="sm" variant="surface">
        {scopeLabel(assignment)}
      </Badge>
      {assignment.groupName ? (
        <Text color="fg.subtle">through {assignment.groupName}</Text>
      ) : null}
    </HStack>
  );
}

/**
 * Everything one person or group holds, or the honest absence.
 *
 * "No role assigned" rather than a blank: a blank cell in a list reads as
 * "still loading", and an administrator scanning for people with no access
 * cannot tell the two apart.
 */
export function RoleAssignmentList({
  assignments,
  align = "end",
}: {
  assignments: RoleAssignmentView[];
  align?: "start" | "end";
}) {
  if (assignments.length === 0) {
    return (
      <Text fontSize="xs" color="fg.subtle">
        No role assigned
      </Text>
    );
  }

  return (
    <VStack gap={1} align={align}>
      {assignments.map((assignment) => (
        <RoleAssignment key={assignment.id} assignment={assignment} />
      ))}
    </VStack>
  );
}

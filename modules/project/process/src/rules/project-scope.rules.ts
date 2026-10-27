/**
 * Which projects a request reaches. A member reaches the projects its own grants name, at
 * their team or at the project itself; a request naming no scope at all reaches none.
 */

export type MemberScopes = Readonly<{
  teamIds: readonly string[];
  projectIds: readonly string[];
}>;

type ScopeBinding = Readonly<{ scopeType: string; scopeId: string }>;

export function memberScopes(bindings: readonly ScopeBinding[]): MemberScopes {
  const scopeIds = (scopeType: "TEAM" | "PROJECT") =>
    bindings.filter((binding) => binding.scopeType === scopeType).map(({ scopeId }) => scopeId);

  return { teamIds: scopeIds("TEAM"), projectIds: scopeIds("PROJECT") };
}

/** A member granted neither a team nor a project of its own reaches nothing shared. */
export function reachesNoScope(member: MemberScopes): boolean {
  return member.teamIds.length === 0 && member.projectIds.length === 0;
}

/** Organisation-wide is a scope of its own, so only a request naming none asks for nothing. */
export function namesNoScope(
  input: MemberScopes & Readonly<{ organizationWide: boolean }>,
): boolean {
  return !input.organizationWide && reachesNoScope(input);
}

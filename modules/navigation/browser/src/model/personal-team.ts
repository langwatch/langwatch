interface PersonalTeamFields {
  isPersonal?: boolean | null;
  ownerUserId?: string | null;
}

export function isOwnPersonalTeam(team: PersonalTeamFields, userId: string | undefined): boolean {
  return !!team.isPersonal && !!userId && team.ownerUserId === userId;
}

/**
 * Whether the switcher lists the team. An admin may open a colleague's
 * personal workspace by link, but ADR-038 keeps it out of the list.
 */
export function isListedInSwitcher(team: PersonalTeamFields, userId: string | undefined): boolean {
  return !team.isPersonal || isOwnPersonalTeam(team, userId);
}

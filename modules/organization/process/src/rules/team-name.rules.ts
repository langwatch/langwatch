/** Team names are unique per organization, compared trimmed and case-insensitively (WEB-11100). */
export function teamNameTaken({
  name,
  teams,
  exceptTeamId,
}: {
  name: string;
  teams: readonly { readonly id: string; readonly name: string }[];
  exceptTeamId?: string;
}): boolean {
  const wanted = name.trim().toLowerCase();
  return teams.some(
    (team) => team.id !== exceptTeamId && team.name.trim().toLowerCase() === wanted,
  );
}

type ScopeName = { id: string; name: string };

export function modelProviderScopeNames(available: {
  organization: ScopeName | null;
  teams: ScopeName[];
  projects: Array<ScopeName & { teamId: string }>;
}): Map<string, string> {
  return new Map([
    ...(available.organization
      ? [[available.organization.id, available.organization.name] as const]
      : []),
    ...available.teams.map((scope) => [scope.id, scope.name] as const),
    ...available.projects.map((scope) => [scope.id, scope.name] as const),
  ]);
}

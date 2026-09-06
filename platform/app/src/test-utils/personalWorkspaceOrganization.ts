/**
 * Organization graph for the personal-workspace resolution tests, shaped the
 * way `organization.getAll` returns it.
 *
 * The personal team is listed before the shared one on purpose: that ordering
 * is what let a personal workspace win the ambient context, so a fixture that
 * quietly sorted the shared team first would let the tests pass without
 * meaning anything.
 *
 * Shared by the hook test and the Model Providers page test. The `vi.hoisted`
 * mocks in those files stay local to each: hoisting is per-module, and their
 * factories close over the mock objects, so those cannot be imported.
 */

export const PERSONAL_TEAM = {
  id: "team-personal",
  name: "Jane's Workspace",
  slug: "personal-jane",
  isPersonal: true,
  ownerUserId: "user-jane",
  members: [{ role: "ADMIN" }],
  projects: [
    {
      id: "proj-personal",
      name: "Personal Workspace",
      slug: "personal-jane-abc123",
      isPersonal: true,
    },
  ],
};

export const SHARED_TEAM = {
  id: "team-shared",
  name: "ACME",
  slug: "acme",
  isPersonal: false,
  ownerUserId: null,
  members: [{ role: "ADMIN" }],
  projects: [{ id: "proj-app", name: "ACME App", slug: "acme-app" }],
};

/** One organization holding exactly the teams given, personal team first. */
export function organizationWith(teams: unknown[]) {
  return [
    {
      id: "org-acme",
      name: "ACME",
      slug: "acme",
      primaryIntent: null,
      members: [{ role: "ADMIN" }],
      teams,
    },
  ];
}

/** The shape `api.organization.getAll.useQuery` hands back once loaded. */
export function loadedOrganizationsQuery(teams: unknown[]) {
  return {
    data: organizationWith(teams),
    isLoading: false,
    isFetched: true,
    isRefetching: false,
  };
}

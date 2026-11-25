/** The organization tree and fake host the CLI authorize screen's suites open the page with. */

import { FakeApiKeyHost } from "../../../../testing.tsx";

export const ORG_WITH_TEAMS = [
  {
    id: "org-1",
    name: "ACME",
    teams: [
      {
        id: "team-1",
        name: "Platform",
        isPersonal: false,
        projects: [{ id: "proj-1", name: "Web App", slug: "web-app" }],
      },
      {
        id: "team-2",
        name: "Growth",
        isPersonal: false,
        projects: [{ id: "proj-2", name: "Growth App", slug: "growth-app" }],
      },
      {
        id: "team-personal",
        name: "Jane's Workspace",
        isPersonal: true,
        ownerUserId: "user-1",
        projects: [
          {
            id: "proj-personal",
            name: "Personal Workspace",
            slug: "jane-personal",
            isPersonal: true,
            ownerUserId: "user-1",
          },
        ],
      },
    ],
  },
];

export function hostFor(options: Partial<ConstructorParameters<typeof FakeApiKeyHost>[0]> = {}) {
  return new FakeApiKeyHost({
    query: { user_code: "WDJB-MJHT" },
    organizations: ORG_WITH_TEAMS,
    ...options,
  });
}

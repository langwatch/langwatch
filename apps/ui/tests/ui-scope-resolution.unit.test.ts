/**
 * The scope rules, carried over from the application's
 * `useOrganizationTeamProject` and asserted the same way its own tests assert
 * them.
 *
 * A page's organization, team and project decide what every write on it lands
 * in — model provider credentials above all — so a second, slightly different
 * answer is a tenancy bug rather than a cosmetic difference. These cases are
 * the application's: the personal-workspace ordering, the team-membership
 * ordering, the stickiness rules and the healing write-back, restated against
 * the pure resolution this package harvested them into. The cases the original
 * never covered — reserved slugs, the demo project, the guarded writes — are
 * marked where they appear.
 */

import { describe, expect, it } from "vitest";
import {
  organizationRoleOf,
  projectSlugAddressedBy,
  resolveUiScope,
  selectAmbientTeam,
  uiScopeSelectionWrites,
  userCanOpenTeam,
} from "../src/behavior/ui-scope-resolution";
import {
  UI_RESERVED_PROJECT_SLUGS,
  type UiScopeOrganization,
  type UiScopeTeam,
} from "../src/model/ui-scope";
import {
  JANE,
  NOTHING_REMEMBERED,
  organizationWith,
  PERSONAL_TEAM,
  SHARED_TEAM,
} from "./fixtures/ui-scope-graph";

const ORGANIZATION_SCOPED_PAGE = { isPersonalScopeRoute: false } as const;
const PERSONAL_SCOPED_PAGE = { isPersonalScopeRoute: true } as const;

function resolve({
  route = ORGANIZATION_SCOPED_PAGE,
  organizations,
  userId = JANE,
  selection = NOTHING_REMEMBERED,
  demoProjectSlug,
}: {
  route?: { projectParam?: string; teamParam?: string; isPersonalScopeRoute: boolean };
  organizations: readonly UiScopeOrganization[] | undefined;
  userId?: string | undefined;
  selection?: { organizationId: string; teamId: string; projectSlug: string };
  demoProjectSlug?: string;
}) {
  return resolveUiScope({ route, organizations, userId, selection, demoProjectSlug });
}

describe("given an organization whose personal workspace is listed first", () => {
  const organizations = organizationWith({ teams: [PERSONAL_TEAM, SHARED_TEAM] });

  describe("when an organization-scoped page resolves with nothing selected yet", () => {
    it("resolves the shared team even though the personal one is listed first", () => {
      expect(resolve({ organizations }).team?.id).toBe("team-shared");
    });

    it("resolves the organization's project, which is what settings writes against", () => {
      expect(resolve({ organizations }).project?.id).toBe("proj-app");
    });
  });

  describe("when the shared team holds no project yet", () => {
    const withEmptyShared = organizationWith({
      teams: [PERSONAL_TEAM, { ...SHARED_TEAM, projects: [] }],
    });

    it("still resolves the shared team rather than the personal one that has a project", () => {
      expect(resolve({ organizations: withEmptyShared }).team?.id).toBe("team-shared");
    });

    it("leaves the page without a project, so it can say a project comes first", () => {
      expect(resolve({ organizations: withEmptyShared }).project).toBeUndefined();
    });
  });

  describe("when the personal project is named in the address bar", () => {
    const addressed = {
      ...ORGANIZATION_SCOPED_PAGE,
      projectParam: "personal-jane-abc123",
    };

    it("resolves the personal project", () => {
      expect(resolve({ route: addressed, organizations }).project?.id).toBe("proj-personal");
    });

    it("resolves the personal team, which the personal chrome keys off", () => {
      expect(resolve({ route: addressed, organizations }).team?.id).toBe("team-personal");
    });
  });

  describe("when the personal project is only the remembered selection", () => {
    const remembered = {
      organizationId: "org-acme",
      teamId: "team-personal",
      projectSlug: "personal-jane-abc123",
    };

    it("resolves the organization's project instead", () => {
      expect(resolve({ organizations, selection: remembered }).project?.id).toBe("proj-app");
    });

    it("resolves the shared team instead", () => {
      expect(resolve({ organizations, selection: remembered }).team?.id).toBe("team-shared");
    });

    it("asks for the shared selection to be written over the stale personal one", () => {
      const resolved = resolve({ organizations, selection: remembered });

      expect(
        uiScopeSelectionWrites({
          resolved,
          selection: remembered,
          projectParam: void 0,
          lastVisitedHomeKind: "",
        }),
      ).toEqual([
        { key: "teamId", value: "team-shared" },
        { key: "projectSlug", value: "acme-app" },
      ]);
    });
  });

  describe("when a ?team= slug matches no team the reader can see", () => {
    const staleTeamLink = { ...ORGANIZATION_SCOPED_PAGE, teamParam: "team-that-no-longer-exists" };
    const rememberedPersonal = {
      organizationId: "org-acme",
      teamId: "team-personal",
      projectSlug: "personal-jane-abc123",
    };

    it("resolves the shared team rather than the remembered personal one", () => {
      const resolved = resolve({
        route: staleTeamLink,
        organizations,
        selection: rememberedPersonal,
      });

      expect(resolved.team?.id).toBe("team-shared");
      expect(resolved.project?.id).toBe("proj-app");
    });

    it("still resolves the personal workspace when the slug does match it", () => {
      const resolved = resolve({
        route: { ...ORGANIZATION_SCOPED_PAGE, teamParam: "personal-jane" },
        organizations,
        selection: rememberedPersonal,
      });

      expect(resolved.team?.id).toBe("team-personal");
      expect(resolved.project?.id).toBe("proj-personal");
    });
  });

  describe("when a shared project is named in the address bar", () => {
    it("resolves that project and its team", () => {
      const resolved = resolve({
        route: { ...ORGANIZATION_SCOPED_PAGE, projectParam: "acme-app" },
        organizations,
      });

      expect(resolved.project?.id).toBe("proj-app");
      expect(resolved.team?.id).toBe("team-shared");
    });
  });
});

describe("given an organization whose only team is the personal one", () => {
  const organizations = organizationWith({ teams: [PERSONAL_TEAM] });

  it("resolves the personal workspace rather than leaving the app contextless", () => {
    const resolved = resolve({ organizations });

    expect(resolved.team?.id).toBe("team-personal");
    expect(resolved.project?.id).toBe("proj-personal");
  });

  it("keeps resolving it when it is also the remembered selection", () => {
    const resolved = resolve({
      organizations,
      selection: {
        organizationId: "org-acme",
        teamId: "team-personal",
        projectSlug: "personal-jane-abc123",
      },
    });

    expect(resolved.team?.id).toBe("team-personal");
    expect(resolved.project?.id).toBe("proj-personal");
  });
});

describe("given the personal-workspace pages", () => {
  const organizations = organizationWith({ teams: [PERSONAL_TEAM, SHARED_TEAM] });

  describe("when nothing is selected yet", () => {
    it("resolves the personal team instead of the shared one", () => {
      expect(resolve({ route: PERSONAL_SCOPED_PAGE, organizations }).team?.id).toBe(
        "team-personal",
      );
    });

    it("resolves the personal project instead of the organization's", () => {
      expect(resolve({ route: PERSONAL_SCOPED_PAGE, organizations }).project?.id).toBe(
        "proj-personal",
      );
    });
  });

  describe("when the shared team holds no project", () => {
    it("still resolves the personal team and project, not an empty shared one", () => {
      const resolved = resolve({
        route: PERSONAL_SCOPED_PAGE,
        organizations: organizationWith({
          teams: [PERSONAL_TEAM, { ...SHARED_TEAM, projects: [] }],
        }),
      });

      expect(resolved.team?.id).toBe("team-personal");
      expect(resolved.project?.id).toBe("proj-personal");
    });
  });

  describe("when a shared team is remembered from an earlier organization-scoped visit", () => {
    it("still resolves the personal team, not the remembered shared one", () => {
      const resolved = resolve({
        route: PERSONAL_SCOPED_PAGE,
        organizations,
        selection: { organizationId: "", teamId: "team-shared", projectSlug: "" },
      });

      expect(resolved.team?.id).toBe("team-personal");
      expect(resolved.project?.id).toBe("proj-personal");
    });

    it("resolves the personal project, not the remembered shared project", () => {
      const resolved = resolve({
        route: PERSONAL_SCOPED_PAGE,
        organizations,
        selection: {
          organizationId: "org-acme",
          teamId: "team-shared",
          projectSlug: "acme-app",
        },
      });

      expect(resolved.team?.id).toBe("team-personal");
      expect(resolved.project?.id).toBe("proj-personal");
    });

    it("leaves the remembered organization work untouched, so the next page opens it again", () => {
      const remembered = {
        organizationId: "org-acme",
        teamId: "team-shared",
        projectSlug: "acme-app",
      };
      const personal = resolve({
        route: PERSONAL_SCOPED_PAGE,
        organizations,
        selection: remembered,
      });

      expect(
        uiScopeSelectionWrites({
          resolved: personal,
          selection: remembered,
          projectParam: void 0,
          lastVisitedHomeKind: "",
        }),
      ).toEqual([]);
      expect(resolve({ organizations, selection: remembered }).project?.slug).toBe("acme-app");
    });
  });

  describe("when the reader has no personal workspace of their own", () => {
    it("falls back to the ambient team rather than resolving nothing", () => {
      const resolved = resolve({
        route: PERSONAL_SCOPED_PAGE,
        organizations: organizationWith({ teams: [SHARED_TEAM] }),
      });

      expect(resolved.team?.id).toBe("team-shared");
    });
  });
});

describe("given a member of one team in an organization that has several", () => {
  const MEMBER = "user-member";
  /** The team the member is NOT on. Listed first, so ordering alone elects it. */
  const OTHER_TEAM: UiScopeTeam = {
    id: "team-platform",
    slug: "acme-platform",
    isPersonal: false,
    ownerUserId: null,
    members: [],
    projects: [{ id: "proj-platform", slug: "platform-app", name: "Platform App" }],
  };
  /** The owning team, where the member holds a real membership row. */
  const OWNING_TEAM: UiScopeTeam = {
    id: "team-data",
    slug: "acme-data",
    isPersonal: false,
    ownerUserId: null,
    members: [{ userId: MEMBER }],
    projects: [{ id: "proj-data", slug: "data-app", name: "Data App" }],
  };
  const organizations = organizationWith({
    teams: [OTHER_TEAM, OWNING_TEAM],
    organizationRole: "MEMBER",
  });

  /**
   * The predicate the page body gates on, restated here rather than imported.
   * What the resolution has to produce is not merely "a team" but one the
   * caller can be shown a page for, and an independent statement of that is
   * what makes the assertion mean anything.
   */
  function chromeWouldRefuse({
    team,
    organizationRole,
  }: {
    team: UiScopeTeam | undefined;
    organizationRole: string | undefined;
  }): boolean {
    if (organizationRole === "ADMIN") return false;
    return !(team?.members?.some((member) => member.userId === MEMBER) ?? false);
  }

  describe("when they open a settings page with nothing selected yet", () => {
    it("resolves the team the member is on, not the one that sorts first", () => {
      const resolved = resolve({ organizations, userId: MEMBER });

      expect(resolved.team?.id).toBe("team-data");
      expect(
        chromeWouldRefuse({
          team: resolved.team,
          organizationRole: resolved.organizationRole,
        }),
      ).toBe(false);
    });

    it("resolves that team's project, which is what settings writes against", () => {
      expect(resolve({ organizations, userId: MEMBER }).project?.slug).toBe("data-app");
    });
  });

  describe("when a remembered selection names a team they are not on", () => {
    const remembered = {
      organizationId: "",
      teamId: "team-platform",
      projectSlug: "platform-app",
    };

    it("ignores the remembered team and resolves the one they hold", () => {
      const resolved = resolve({ organizations, userId: MEMBER, selection: remembered });

      expect(resolved.team?.id).toBe("team-data");
      expect(resolved.project?.slug).toBe("data-app");
    });

    it("asks for the resolved selection to be written, so the stale one heals", () => {
      const resolved = resolve({ organizations, userId: MEMBER, selection: remembered });

      expect(
        uiScopeSelectionWrites({
          resolved,
          selection: remembered,
          projectParam: void 0,
          lastVisitedHomeKind: "",
        }),
      ).toEqual([
        { key: "organizationId", value: "org-acme" },
        { key: "teamId", value: "team-data" },
        { key: "projectSlug", value: "data-app" },
      ]);
    });
  });

  describe("when an organization admin opens a page after working in another team's project", () => {
    const asAdmin = organizationWith({
      teams: [OTHER_TEAM, OWNING_TEAM],
      organizationRole: "ADMIN",
    });

    it("keeps the project they picked, and its team", () => {
      const resolved = resolve({
        organizations: asAdmin,
        userId: MEMBER,
        selection: {
          organizationId: "",
          teamId: "team-platform",
          projectSlug: "platform-app",
        },
      });

      expect(resolved.project?.slug).toBe("platform-app");
      expect(resolved.team?.id).toBe("team-platform");
      expect(resolved.organizationRole).toBe("ADMIN");
    });

    it("keeps the remembered team when only the team is remembered", () => {
      const resolved = resolve({
        organizations: asAdmin,
        userId: MEMBER,
        selection: { organizationId: "", teamId: "team-platform", projectSlug: "" },
      });

      expect(resolved.team?.id).toBe("team-platform");
    });
  });

  describe("when the reader belongs to no team in the organization", () => {
    it("still resolves a context, and the chrome still refuses them", () => {
      const resolved = resolve({
        organizations: organizationWith({
          teams: [OTHER_TEAM, { ...OWNING_TEAM, members: [] }],
          organizationRole: "MEMBER",
        }),
        userId: MEMBER,
      });

      // A resolved context is what lets the chrome render the refusal at all;
      // leaving it undefined would hang the page on a loading screen.
      expect(resolved.team).toBeDefined();
      expect(
        chromeWouldRefuse({
          team: resolved.team,
          organizationRole: resolved.organizationRole,
        }),
      ).toBe(true);
    });
  });

  describe("when a project named in the address bar belongs to another team", () => {
    it("resolves the addressed team, refusal and all", () => {
      const resolved = resolve({
        route: { ...ORGANIZATION_SCOPED_PAGE, projectParam: "platform-app" },
        organizations,
        userId: MEMBER,
      });

      expect(resolved.team?.id).toBe("team-platform");
      expect(
        chromeWouldRefuse({
          team: resolved.team,
          organizationRole: resolved.organizationRole,
        }),
      ).toBe(true);
    });
  });
});

describe("given the reserved top-level addresses that also bind the project segment", () => {
  const organizations = organizationWith({ teams: [SHARED_TEAM] });
  const remembered = { organizationId: "org-acme", teamId: "team-shared", projectSlug: "acme-app" };

  it("refuses every reserved slug as a project address", () => {
    for (const reserved of UI_RESERVED_PROJECT_SLUGS) {
      expect(projectSlugAddressedBy(reserved)).toBeUndefined();
    }
    expect(projectSlugAddressedBy("acme-app")).toBe("acme-app");
  });

  it("resolves the remembered project rather than looking for one named 'messages'", () => {
    const resolved = resolve({
      route: { ...ORGANIZATION_SCOPED_PAGE, projectParam: "messages" },
      organizations,
      selection: remembered,
    });

    expect(resolved.project?.slug).toBe("acme-app");
  });

  it("does not count the visit as a project-home visit", () => {
    const resolved = resolve({
      route: { ...ORGANIZATION_SCOPED_PAGE, projectParam: "messages" },
      organizations,
      selection: remembered,
    });

    expect(
      uiScopeSelectionWrites({
        resolved,
        selection: remembered,
        projectParam: "messages",
        lastVisitedHomeKind: "personal",
      }),
    ).toEqual([]);
  });

  it("counts a real project address as one", () => {
    const resolved = resolve({
      route: { ...ORGANIZATION_SCOPED_PAGE, projectParam: "acme-app" },
      organizations,
      selection: remembered,
    });

    expect(
      uiScopeSelectionWrites({
        resolved,
        selection: remembered,
        projectParam: "acme-app",
        lastVisitedHomeKind: "personal",
      }),
    ).toEqual([{ key: "lastVisitedHomeKind", value: "project" }]);
  });
});

describe("given the deployment's demo project", () => {
  const DEMO_TEAM: UiScopeTeam = {
    id: "team-demo",
    slug: "demo-team",
    isPersonal: false,
    ownerUserId: null,
    members: [],
    projects: [{ id: "proj-demo", slug: "demo-project-slug", name: "Demo" }],
  };
  const organizations: readonly UiScopeOrganization[] = [
    ...organizationWith({ teams: [SHARED_TEAM] }),
    { id: "org-demo", slug: "demo", members: [], teams: [DEMO_TEAM] },
  ];
  const demoRoute = { ...ORGANIZATION_SCOPED_PAGE, projectParam: "demo-project-slug" };

  it("resolves the organization that holds the demo project, not the reader's own", () => {
    const resolved = resolve({
      route: demoRoute,
      organizations,
      demoProjectSlug: "demo-project-slug",
    });

    expect(resolved.isDemo).toBe(true);
    expect(resolved.organization?.id).toBe("org-demo");
    expect(resolved.project?.id).toBe("proj-demo");
  });

  it("answers to the slug the address bar used", () => {
    const renamed: readonly UiScopeOrganization[] = [
      { id: "org-demo", slug: "demo", members: [], teams: [DEMO_TEAM] },
    ];
    const resolved = resolveUiScope({
      route: { ...ORGANIZATION_SCOPED_PAGE, projectParam: "demo" },
      organizations: renamed,
      userId: JANE,
      selection: NOTHING_REMEMBERED,
      demoProjectSlug: "demo",
    });

    // No project carries the slug "demo", so the team's first one answers for
    // it — under the address the reader typed.
    expect(resolved.project?.id).toBe("proj-demo");
    expect(resolved.project?.slug).toBe("demo");
  });

  it("remembers nothing, because a visitor's demo is not the reader's own work", () => {
    const resolved = resolve({
      route: demoRoute,
      organizations,
      demoProjectSlug: "demo-project-slug",
    });

    expect(
      uiScopeSelectionWrites({
        resolved,
        selection: NOTHING_REMEMBERED,
        projectParam: "demo-project-slug",
        lastVisitedHomeKind: "",
      }),
    ).toEqual([]);
  });

  it("is not a demo when the address names any other project", () => {
    const resolved = resolve({
      route: { ...ORGANIZATION_SCOPED_PAGE, projectParam: "acme-app" },
      organizations,
      demoProjectSlug: "demo-project-slug",
    });

    expect(resolved.isDemo).toBe(false);
    expect(resolved.project?.id).toBe("proj-app");
  });
});

describe("given the organization graph has not answered yet", () => {
  it("resolves no scope at all rather than a guess", () => {
    const resolved = resolve({
      organizations: void 0,
      selection: { organizationId: "org-acme", teamId: "team-shared", projectSlug: "acme-app" },
    });

    expect(resolved.organization).toBeUndefined();
    expect(resolved.team).toBeUndefined();
    expect(resolved.project).toBeUndefined();
  });
});

describe("given the selection write-back", () => {
  const organizations = organizationWith({ teams: [PERSONAL_TEAM, SHARED_TEAM] });

  it("writes nothing when the stored selection already says what resolved", () => {
    const remembered = {
      organizationId: "org-acme",
      teamId: "team-shared",
      projectSlug: "acme-app",
    };

    expect(
      uiScopeSelectionWrites({
        resolved: resolve({ organizations, selection: remembered }),
        selection: remembered,
        projectParam: void 0,
        lastVisitedHomeKind: "project",
      }),
    ).toEqual([]);
  });

  it("never remembers a personal team or project as the place work was happening", () => {
    const resolved = resolve({
      route: { ...ORGANIZATION_SCOPED_PAGE, projectParam: "personal-jane-abc123" },
      organizations,
    });

    // The organization and the home marker are still recorded: the reader did
    // open a project page, and the private context resolves from its own
    // address every time, so neither the team nor the project needs to be.
    expect(
      uiScopeSelectionWrites({
        resolved,
        selection: NOTHING_REMEMBERED,
        projectParam: "personal-jane-abc123",
        lastVisitedHomeKind: "",
      }),
    ).toEqual([
      { key: "organizationId", value: "org-acme" },
      { key: "lastVisitedHomeKind", value: "project" },
    ]);
  });
});

describe("given the two predicates the resolution is built out of", () => {
  describe("when a team is tested against a reader", () => {
    it("opens every team of the organization to its admin", () => {
      expect(
        userCanOpenTeam({ team: { members: [] }, userId: "someone", organizationRole: "ADMIN" }),
      ).toBe(true);
    });

    it("refuses a member a team they hold no row in", () => {
      expect(
        userCanOpenTeam({ team: { members: [] }, userId: "someone", organizationRole: "MEMBER" }),
      ).toBe(false);
    });

    it("holds a reader whose session has not resolved to no test at all", () => {
      expect(
        userCanOpenTeam({ team: { members: [] }, userId: void 0, organizationRole: void 0 }),
      ).toBe(true);
    });
  });

  describe("when the ambient team is picked", () => {
    it("prefers a shared team with a project over one without", () => {
      const teams = [
        { id: "empty", isPersonal: false, projects: [], members: [{ userId: JANE }] },
        { id: "full", isPersonal: false, projects: [{}], members: [{ userId: JANE }] },
      ];

      expect(selectAmbientTeam({ teams, userId: JANE })?.id).toBe("full");
    });

    it("prefers a shared team without a project over a personal one with", () => {
      const teams = [
        { id: "personal", isPersonal: true, projects: [{}], members: [{ userId: JANE }] },
        { id: "empty", isPersonal: false, projects: [], members: [{ userId: JANE }] },
      ];

      expect(selectAmbientTeam({ teams, userId: JANE })?.id).toBe("empty");
    });

    it("falls back to every team when the reader is on none of them", () => {
      const teams = [{ id: "other", isPersonal: false, projects: [{}], members: [] }];

      expect(selectAmbientTeam({ teams, userId: JANE })?.id).toBe("other");
    });
  });

  describe("when the reader's own organization role is read", () => {
    it("takes the caller's row, which is the only one the graph carries", () => {
      expect(organizationRoleOf({ members: [{ role: "EXTERNAL" }] })).toBe("EXTERNAL");
      expect(organizationRoleOf({ members: [] })).toBeUndefined();
      expect(organizationRoleOf(void 0)).toBeUndefined();
    });
  });
});

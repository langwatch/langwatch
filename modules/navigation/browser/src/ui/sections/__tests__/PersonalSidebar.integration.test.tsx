/**
 * @vitest-environment jsdom
 * Personal sidebar: Traces entry by project slug, org follows chrome organization.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WithStubNavigationHost } from "../../../testing.tsx";
import { PersonalSidebarLinks } from "../personal-sidebar.tsx";

type Org = {
  id: string;
  name: string;
  teams: {
    id: string;
    name: string;
    isPersonal: boolean;
    ownerUserId: string | null;
    projects: { id: string; name: string; slug: string }[];
  }[];
};

const state: {
  organizations: Org[];
  organization: Org | undefined;
} = { organizations: [], organization: undefined };

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    asPath: "/me",
    pathname: "/me",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organizations: state.organizations,
    organization: state.organization,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    personalWorkspaceFeatures: {
      get: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    personalWorkspaceFeatures: { get: { useQuery: () => ({ data: undefined }) } },
  },
}));

const orgWithPersonalProject = ({ orgId, slug }: { orgId: string; slug: string }): Org => ({
  id: orgId,
  name: orgId,
  teams: [
    {
      id: `team-${slug}`,
      name: "Personal",
      isPersonal: true,
      ownerUserId: "user-1",
      projects: [{ id: `proj-${slug}`, name: "Personal", slug }],
    },
  ],
});

function renderLinks() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          pathname: "/me",
          currentUserId: "user-1",
          openableTeams: state.organization?.teams ?? [],
        }}
      >
        <PersonalSidebarLinks showExpanded={true} />
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
}

const tracesHref = () =>
  screen.queryByRole("link", { name: "Traces" })?.getAttribute("href") ?? null;

describe("PersonalSidebarLinks", () => {
  beforeEach(() => {
    state.organizations = [
      orgWithPersonalProject({ orgId: "org-first", slug: "personal-first" }),
      orgWithPersonalProject({ orgId: "org-second", slug: "personal-second" }),
    ];
    state.organization = state.organizations[1];
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the user owns a personal workspace in several organizations", () => {
    /** @scenario "The Me sidebar's Traces entry stays inside the selected organization" */
    it("links Traces to the personal project of the selected organization", () => {
      renderLinks();

      expect(tracesHref()).toBe("/personal-second/traces");
    });

    it("follows the selection when a different organization is showing", () => {
      state.organization = state.organizations[0];

      renderLinks();

      expect(tracesHref()).toBe("/personal-first/traces");
    });
  });

  describe("given the loaded organization holds no personal workspace", () => {
    /** @scenario "The Me sidebar offers no Traces entry until it can see one here" */
    it("renders no Traces entry", () => {
      state.organizations = [
        orgWithPersonalProject({ orgId: "org-first", slug: "personal-first" }),
        { id: "org-shared", name: "Shared", teams: [] },
      ];
      state.organization = state.organizations[1];

      renderLinks();

      expect(tracesHref()).toBeNull();
    });
  });

  describe("given the personal entries that address no organization", () => {
    it("renders them whichever organization is selected", () => {
      renderLinks();

      expect(screen.getByRole("link", { name: "Sessions" }).getAttribute("href")).toBe(
        "/me/sessions",
      );
      expect(screen.getByRole("link", { name: "Configure" }).getAttribute("href")).toBe(
        "/me/configure",
      );
    });
  });
});

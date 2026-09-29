/**
 * @vitest-environment jsdom
 *
 * The Me sidebar's Traces entry addresses the personal workspace by project
 * slug, and a user who belongs to several organizations owns one personal
 * workspace per organization. The entry has to follow the organization the
 * chrome is currently showing: pointing at another organization's personal
 * project navigates away from the selected organization, and the header then
 * re-derives the organization from the project slug in the URL, so the
 * organization visibly flips.
 *
 * Spec: specs/navigation/product-sidebars.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalSidebarLinks } from "../PersonalSidebar";

type Org = {
  id: string;
  teams: Array<{
    isPersonal: boolean;
    ownerUserId: string | null;
    projects: Array<{ id: string; slug: string }>;
  }>;
};

const state: {
  organizations: Org[];
  organization: { id: string } | undefined;
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
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
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

const orgWithPersonalProject = ({
  orgId,
  slug,
}: {
  orgId: string;
  slug: string;
}): Org => ({
  id: orgId,
  teams: [
    {
      isPersonal: true,
      ownerUserId: "user-1",
      projects: [{ id: `proj-${slug}`, slug }],
    },
  ],
});

function renderLinks() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <PersonalSidebarLinks showExpanded={true} />
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
    state.organization = { id: "org-second" };
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
      state.organization = { id: "org-first" };

      renderLinks();

      expect(tracesHref()).toBe("/personal-first/traces");
    });
  });

  describe("given the loaded organization holds no personal workspace", () => {
    /** @scenario "The Me sidebar offers no Traces entry until it can see one here" */
    it("renders no Traces entry", () => {
      state.organizations = [
        orgWithPersonalProject({ orgId: "org-first", slug: "personal-first" }),
        { id: "org-shared", teams: [] },
      ];
      state.organization = { id: "org-shared" };

      renderLinks();

      expect(tracesHref()).toBeNull();
    });
  });

  describe("given the personal entries that address no organization", () => {
    it("renders them whichever organization is selected", () => {
      renderLinks();

      expect(
        screen.getByRole("link", { name: "Sessions" }).getAttribute("href"),
      ).toBe("/me/sessions");
      expect(
        screen.getByRole("link", { name: "Configure" }).getAttribute("href"),
      ).toBe("/me/configure");
    });
  });
});

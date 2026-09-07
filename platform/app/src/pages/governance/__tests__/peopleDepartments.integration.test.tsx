/**
 * @vitest-environment jsdom
 *
 * What the People screen does with the two departments a person can carry:
 * the one their provider's directory named, and the one their linked member
 * is assigned to.
 *
 * The real page renders, with only its boundaries mocked - the layout chrome,
 * the feature flag, the permission hook and the tRPC client. The department
 * decisions are the page's own.
 *
 * Spec: specs/governance/governance-people-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  people: [] as unknown[],
  departments: [] as unknown[],
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
    organizations: [],
    project: undefined,
    hasPermission: () => true,
    hasOrgPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/governance/people",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => {
  const dataFor = (path: string): unknown => {
    if (path === "governancePeople.list") return harness.people;
    if (path === "governancePeople.suggestions") return [];
    if (path === "departments.list") return harness.departments;
    return undefined;
  };
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () => ({
              data: dataFor(path.join(".")),
              isLoading: false,
              isFetching: false,
              isError: false,
              error: null,
              refetch: vi.fn(),
            });
          }
          if (property === "useMutation") {
            return () => ({
              mutate: vi.fn(),
              mutateAsync: vi.fn(),
              isPending: false,
              variables: undefined,
            });
          }
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );
  return { api: node([]) };
});

import PeoplePage from "../people";

const seenAt = new Date("2026-08-01T00:00:00.000Z");

const discovered = (over: Record<string, unknown>) => ({
  id: `person_${String(over.displayText ?? "x")}`,
  provider: "copilot_studio_dataverse",
  kind: "person",
  displayText: "Someone",
  rawActorId: "someone",
  directoryDepartment: null,
  firstSeenAt: seenAt,
  lastSeenAt: seenAt,
  erasedAt: null,
  suspendedAt: null,
  suspendedReason: null,
  link: null,
  ...over,
});

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/governance/people"]}>
        <PeoplePage />
      </MemoryRouter>
    </ChakraProvider>,
  );

afterEach(() => {
  cleanup();
  harness.people = [];
  harness.departments = [];
});

describe("given people the providers named", () => {
  describe("when the directory filed some of them under a department", () => {
    /** @scenario "An unlinked person shows the department their directory named" */
    it("shows the directory department on a person linked to nobody", () => {
      harness.people = [
        discovered({
          displayText: "Maria Silva",
          directoryDepartment: "Engineering",
        }),
      ];
      renderPage();

      expect(screen.getByText("Maria Silva")).toBeInTheDocument();
      expect(screen.getAllByText("Engineering").length).toBeGreaterThan(0);
    });

    it("lists the departments the providers see with a headcount each", () => {
      harness.people = [
        discovered({ displayText: "A", directoryDepartment: "Engineering" }),
        discovered({ displayText: "B", directoryDepartment: "Engineering" }),
        discovered({ displayText: "C", directoryDepartment: "GTM" }),
        discovered({ displayText: "D" }),
      ];
      renderPage();

      expect(screen.getByText("Departments the providers see")).toBeVisible();
      expect(screen.getByText("2 people")).toBeVisible();
      expect(screen.getByText("1 person")).toBeVisible();
    });

    it("keeps the organization's own department list separate and still empty", () => {
      // The directory naming departments must not put rows in the list an
      // administrator creates, renames and archives — that list is the spend
      // attribution entity, and nothing here was created by anybody.
      harness.people = [
        discovered({ displayText: "A", directoryDepartment: "Engineering" }),
      ];
      renderPage();

      expect(
        screen.getByText(
          "No departments yet. Create one above to start attributing spend.",
        ),
      ).toBeVisible();
    });
  });

  describe("when no directory named a department for anybody", () => {
    it("offers no departments panel rather than an empty one", () => {
      harness.people = [discovered({ displayText: "Maria Silva" })];
      renderPage();

      expect(
        screen.queryByText("Departments the providers see"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when a person is linked to a member with a department", () => {
    it("still shows the linked member and their department", () => {
      harness.people = [
        discovered({
          displayText: "Maria Silva",
          link: {
            userId: "user-1",
            evidenceKind: "verified_email",
            memberName: "Maria Silva",
            departmentName: "Finance",
          },
        }),
      ];
      renderPage();

      expect(screen.getByText("Maria Silva · Finance")).toBeVisible();
    });

    /** @scenario "The directory's department wins over the linked member's" */
    it("prefers the directory's department over the linked member's", () => {
      harness.people = [
        discovered({
          displayText: "Maria Silva",
          directoryDepartment: "Engineering",
          link: {
            userId: "user-1",
            evidenceKind: "verified_email",
            memberName: "Maria Silva",
            departmentName: "Finance",
          },
        }),
      ];
      renderPage();

      expect(screen.getByText("Maria Silva · Engineering")).toBeVisible();
    });
  });

  describe("when a person has been erased", () => {
    it("shows no department beside the stand-in they now wear", () => {
      harness.people = [
        discovered({
          displayText: "pseudonym_abc",
          rawActorId: "pseudonym_abc",
          // Erasure nulls the stored column; a row that somehow kept one must
          // still not render it beside a person we were asked to forget.
          directoryDepartment: "Engineering",
          erasedAt: seenAt,
        }),
      ];
      renderPage();

      expect(screen.getByText("pseudonym_abc")).toBeVisible();
      expect(screen.queryByText("Engineering")).not.toBeInTheDocument();
    });
  });
});

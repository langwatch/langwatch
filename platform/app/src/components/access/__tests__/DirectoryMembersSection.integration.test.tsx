/**
 * @vitest-environment jsdom
 *
 * The people the directory actually provisioned, named rather than counted.
 *
 * The status band above this list says "People it manages: 12", and a count is
 * the one answer an administrator cannot check. What this drives is the list
 * that makes it checkable: who is on it, who is deliberately not, what each
 * row says about a person, and what it says when the directory has provisioned
 * nobody at all.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  members: [] as unknown[],
  membersError: null as unknown,
  provenance: {} as Record<string, unknown>,
  provenanceError: null as unknown,
}));

vi.mock("~/utils/api", () => ({
  api: {
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({
          data: { members: state.members },
          isLoading: false,
          isError: state.membersError !== null,
          error: state.membersError,
        }),
      },
      getMemberProvenance: {
        useQuery: () => ({
          data: state.provenance,
          isLoading: false,
          isError: state.provenanceError !== null,
          error: state.provenanceError,
        }),
      },
    },
  },
}));

const { DirectoryMembersSection } = await import("../DirectoryMembersSection");

const wrap = (node: ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);

const draw = () => wrap(<DirectoryMembersSection organizationId="org_acme" />);

/** One row of the roster, in the shape the members query answers with. */
function member({
  userId,
  name,
  email,
  role = "MEMBER",
  disabledAt = null,
  deactivatedAt = null,
}: {
  userId: string;
  name: string;
  email: string;
  role?: string;
  disabledAt?: Date | null;
  deactivatedAt?: Date | null;
}) {
  return {
    userId,
    role,
    disabledAt,
    user: { id: userId, name, email, image: null, deactivatedAt },
  };
}

beforeEach(() => {
  state.members = [
    member({ userId: "user_a", name: "Ana Silva", email: "ana@acme.com" }),
    member({
      userId: "user_b",
      name: "Sam Patel",
      email: "sam@acme.com",
      role: "ADMIN",
    }),
    member({ userId: "user_c", name: "Kit Lee", email: "kit@acme.com" }),
  ];
  state.membersError = null;
  state.provenance = {
    user_a: { source: "directory", providerId: "okta" },
    user_b: { source: "directory", providerId: "okta" },
    user_c: { source: "domain", domain: "acme.com", automatic: true },
  };
  state.provenanceError = null;
});
afterEach(() => cleanup());

describe("given the people a directory manages", () => {
  describe("when the directory has provisioned some of the organization", () => {
    /** @scenario "The people who arrived another way are not in that list" */
    it("names the ones it manages and leaves out the ones it does not", () => {
      draw();

      const list = screen.getByTestId("directory-managed-members");
      expect(within(list).getByText("Ana Silva")).toBeTruthy();
      expect(within(list).getByText("Sam Patel")).toBeTruthy();
      // Kit walked in on the domain policy. The directory did not put them
      // here and removing them from it would not remove them here.
      expect(within(list).queryByText("Kit Lee")).toBeNull();
    });

    /** @scenario "The directory's own people are listed by name" */
    it("gives each person their address, their access and where they came from", () => {
      draw();

      const rows = screen.getAllByTestId("directory-managed-member");
      const ana = rows[0]!;
      expect(ana.textContent).toContain("Ana Silva");
      expect(ana.textContent).toContain("ana@acme.com");
      expect(ana.textContent).toContain("Member");
      expect(within(ana).getByTestId("provenance-directory")).toBeTruthy();
    });

    /** @scenario "The directory's own people are listed by name" */
    it("says which role each person holds in the organization's own words", () => {
      draw();

      const sam = screen.getAllByTestId("directory-managed-member")[1]!;
      expect(sam.textContent).toContain("Admin");
    });
  });

  describe("when somebody the directory manages cannot currently get in", () => {
    /** @scenario "Somebody managed whose access is switched off is still listed" */
    it("marks the person whose access is switched off here", () => {
      state.members = [
        member({
          userId: "user_a",
          name: "Ana Silva",
          email: "ana@acme.com",
          disabledAt: new Date(),
        }),
      ];
      state.provenance = {
        user_a: { source: "directory", providerId: "okta" },
      };
      draw();

      expect(screen.getByTestId("member-disabled")).toBeTruthy();
    });

    /** @scenario "Somebody managed whose access is switched off is still listed" */
    it("marks a deactivated account rather than dropping it from the count's list", () => {
      state.members = [
        member({
          userId: "user_a",
          name: "Ana Silva",
          email: "ana@acme.com",
          deactivatedAt: new Date(),
        }),
      ];
      state.provenance = {
        user_a: { source: "directory", providerId: "okta" },
      };
      draw();

      expect(screen.getByText("Ana Silva")).toBeTruthy();
      expect(screen.getByTestId("member-deactivated")).toBeTruthy();
    });

    /** @scenario "Somebody managed whose access is switched off is still listed" */
    it("says nothing about access that is simply on", () => {
      draw();

      expect(screen.queryByTestId("member-disabled")).toBeNull();
      expect(screen.queryByTestId("member-deactivated")).toBeNull();
    });
  });

  describe("when the directory has provisioned nobody", () => {
    /** @scenario "A directory that has provisioned nobody says so honestly" */
    it("says the members here arrived another way rather than that nobody is here", () => {
      state.provenance = {
        user_a: { source: "invited" },
        user_b: { source: "invited" },
        user_c: { source: "domain", domain: "acme.com", automatic: true },
      };
      draw();

      const list = screen.getByTestId("directory-managed-members");
      expect(list.textContent).toContain("has not provisioned anyone yet");
      expect(list.textContent).toContain("All 3 members here arrived another");
      expect(list.textContent).not.toContain("Nobody is in this organization");
    });

    /** @scenario "A directory that has provisioned nobody says so honestly" */
    it("says the organization is empty only when it actually is", () => {
      state.members = [];
      state.provenance = {};
      draw();

      expect(
        screen.getByTestId("directory-managed-members").textContent,
      ).toContain("Nobody is in this organization yet.");
    });
  });

  describe("when a read this list is built from fails", () => {
    /** @scenario "A roster that could not be read is not drawn as an empty one" */
    it("names the failure rather than drawing a roster it cannot vouch for", () => {
      state.provenanceError = {
        message: "unknown_error",
        data: { httpStatus: 500 },
      };
      draw();

      expect(
        screen.getByText(/Couldn't read the people your directory manages/i),
      ).toBeTruthy();
    });

    /** @scenario "A roster that could not be read is not drawn as an empty one" */
    it("says nobody is managed rather than listing everybody as managed", () => {
      state.provenanceError = {
        message: "unknown_error",
        data: { httpStatus: 500 },
      };
      state.provenance = {};
      draw();

      expect(screen.queryByTestId("directory-managed-member")).toBeNull();
    });
  });
});

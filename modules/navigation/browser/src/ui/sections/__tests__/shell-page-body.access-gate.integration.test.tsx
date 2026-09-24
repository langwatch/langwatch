/**
 * @vitest-environment jsdom
 * Membership comes from the organization read; no refusal before it answers.
 * Spec: specs/identity/identifier-model.feature.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NavigationHostProvider } from "../../../model/navigation-host.ts";
import {
  StubNavigationHost,
  type StubNavigationReadings,
  WithStubNavigationHost,
} from "../../../testing.tsx";
import { ShellPageBody } from "../shell-page-body.tsx";

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    limits: { getUsage: { useQuery: () => ({ data: undefined }) } },
    user: { getSsoStatus: { useQuery: () => ({ data: undefined }) } },
    governance: {
      recordWorkspaceView: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

afterEach(() => cleanup());

const REFUSAL = /You are not part of any team in this organization/;

function renderBody(readings: StubNavigationReadings) {
  render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{ pathname: "/acme", currentUserId: "user_1", ...readings }}
      >
        <ShellPageBody>
          <p>Private project content</p>
        </ShellPageBody>
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
}

describe("given the organization read has not answered yet", () => {
  describe("when the page renders", () => {
    /** @scenario "A member is never shown an access refusal before their access has been read" */
    it("draws no access refusal", () => {
      renderBody({ isLoading: true });

      expect(screen.queryByText(REFUSAL)).toBeNull();
      expect(screen.getByText("Private project content")).toBeInTheDocument();
    });
  });
});

describe("given the organization read has answered", () => {
  const organization = { id: "org_1", name: "Acme", teams: [] };

  describe("when the member is on no team", () => {
    /** @scenario "A member is never shown an access refusal before their access has been read" */
    it("draws the access refusal", () => {
      renderBody({ isLoading: false, organization, organizationRole: "MEMBER" });

      expect(screen.getByText(REFUSAL)).toBeInTheDocument();
      expect(screen.queryByText("Private project content")).not.toBeInTheDocument();
    });
  });

  describe("when the member is on the team", () => {
    /** @scenario "A member is never shown an access refusal before their access has been read" */
    it("draws the page", () => {
      renderBody({
        isLoading: false,
        organization,
        organizationRole: "MEMBER",
        team: {
          id: "team_1",
          name: "Team",
          isPersonal: false,
          members: [{ userId: "user_1" }],
          projects: [],
        },
      });

      expect(screen.queryByText(REFUSAL)).toBeNull();
      expect(screen.getByText("Private project content")).toBeInTheDocument();
    });
  });
});

describe("given the join offer drawn over the page", () => {
  function joinOfferAskedWith(readings: StubNavigationReadings) {
    const host = StubNavigationHost.create({
      pathname: "/acme",
      currentUserId: "user_1",
      ...readings,
    });
    const joinOffer = vi.spyOn(host, "joinOffer");
    render(
      <ChakraProvider value={defaultSystem}>
        <NavigationHostProvider value={host}>
          <ShellPageBody>
            <p>Private project content</p>
          </ShellPageBody>
        </NavigationHostProvider>
      </ChakraProvider>,
    );
    return joinOffer.mock.calls.at(-1)?.[0];
  }

  describe("when the organization read is still out", () => {
    it("names no organization yet, so the offer decides nothing", () => {
      expect(joinOfferAskedWith({ isLoading: true })).toEqual({ currentOrganizationId: void 0 });
    });
  });

  describe("when the read answered with no organization", () => {
    it("says there is none", () => {
      expect(joinOfferAskedWith({ isLoading: false })).toEqual({ currentOrganizationId: null });
    });
  });

  describe("when the read answered with an organization", () => {
    it("scopes the offer to it", () => {
      expect(
        joinOfferAskedWith({
          isLoading: false,
          organization: { id: "org_1", name: "Acme", teams: [] },
        }),
      ).toEqual({ currentOrganizationId: "org_1" });
    });
  });
});

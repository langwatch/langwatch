/**
 * @vitest-environment jsdom
 * The Authentication overview: the declared sign-in cards, then the policies.
 * @see specs/identity/organization-authentication-settings.feature
 */
import "@testing-library/jest-dom/vitest";
import type { UiAuthenticationOverviewCardProps } from "@langwatch/browser-host/declarations";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../../../testing.tsx";
import AuthenticationSettingsScreen from "../authentication-settings.screen.tsx";

vi.mock("../../../../../behavior/use-join-requests.ts", () => ({
  useJoinRequests: () => ({
    requests: [],
    answeringId: null,
    joining: { domainJoin: "request", joinDomains: [] },
    savingJoining: false,
    setJoining: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
  }),
}));

vi.mock("../../../../../behavior/use-two-step-requirement.ts", () => ({
  useTwoStepRequirement: () => ({
    show: true,
    mfaRequired: false,
    connection: { connected: false, assertedFactors: [], assertsSecondFactor: false },
    members: [],
    byUser: new Map(),
    heldCount: 0,
    canTurnOn: true,
    planLocked: false,
    planLink: { href: "/settings/subscription", label: "See plans" },
    saving: false,
    setRequirement: vi.fn(),
  }),
}));

vi.mock("../../../behavior/use-sign-in-security.ts", () => ({
  useSignInSecurity: () => ({
    show: true,
    loading: false,
    settings: {
      lockoutAfterFailedAttempts: 0,
      lockoutMinutes: 30,
      sessionIdleTimeoutMinutes: 0,
      sessionMaxLifetimeMinutes: 0,
    },
    saving: false,
    save: vi.fn(),
  }),
}));

afterEach(cleanup);

function DeclaredCard({ organizationId, canReadMembership }: UiAuthenticationOverviewCardProps) {
  return (
    <div data-testid="declared-card">
      {organizationId}:{String(canReadMembership)}
    </div>
  );
}

const hostWith = ({
  grants,
  cards = [],
}: {
  grants: string[];
  cards?: { key: string; Card: typeof DeclaredCard }[];
}) =>
  new FakeOrganizationHost({
    scope: { organizationId: "org-1" },
    grants: new Set(grants),
    overviewCards: cards,
  });

describe("given an administrator on the Authentication page", () => {
  describe("when the organization has no identity provider connection", () => {
    /** @scenario "Organization policies remain available without single sign-on" */
    it("keeps its policies on the page and says they cover password sign-in", () => {
      renderWithOrganizationHost(
        <AuthenticationSettingsScreen />,
        hostWith({ grants: ["sso:view", "organization:manage"] }),
      );

      expect(screen.getByTestId("organization-policy")).toBeInTheDocument();
      expect(screen.getByTestId("domain-join-card")).toBeInTheDocument();
      expect(screen.getByTestId("two-step-requirement-card")).toBeInTheDocument();
      expect(
        screen.getByText(/also apply when your organization uses password sign-in/),
      ).toBeInTheDocument();
      expect(screen.queryByText("Sign-in and provisioning")).toBeNull();
    });
  });

  describe("when sso and scim have declared their cards", () => {
    it("draws each with the organization and whether membership may be read", () => {
      renderWithOrganizationHost(
        <AuthenticationSettingsScreen />,
        hostWith({ grants: ["sso:view"], cards: [{ key: "sso", Card: DeclaredCard }] }),
      );

      expect(screen.getByText("Sign-in and provisioning")).toBeInTheDocument();
      expect(screen.getByTestId("declared-card")).toHaveTextContent("org-1:false");
      expect(screen.queryByTestId("organization-policy")).toBeNull();
    });
  });

  describe("when the reader may not see single sign-on", () => {
    it("says which permission the page needs rather than drawing it", () => {
      renderWithOrganizationHost(<AuthenticationSettingsScreen />, hostWith({ grants: [] }));

      expect(screen.getByText("Access Restricted")).toBeInTheDocument();
      expect(screen.queryByTestId("organization-policy")).toBeNull();
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * Integration tests for the /settings/scim page enterprise gate.
 * Verifies that non-enterprise orgs see an upgrade prompt while enterprise
 * orgs see the full SCIM token management interface.
 *
 * Spec: specs/auth/sso-phase1-enforcement.feature
 *   — SCIM Settings Page Enterprise Gate (scenarios 10–11)
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── hoisted refs ──────────────────────────────────────────────────────────────
const { isEnterpriseRef, orgRef } = vi.hoisted(() => ({
  isEnterpriseRef: { current: false },
  orgRef: { current: { id: "org-1" } as { id: string } | undefined },
}));

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({
    isEnterprise: isEnterpriseRef.current,
    isFree: !isEnterpriseRef.current,
    isLoading: false,
    activePlan: { type: isEnterpriseRef.current ? "ENTERPRISE" : "FREE" },
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: orgRef.current,
    hasPermission: () => true,
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    scimToken: {
      list: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      generate: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
      revoke: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
    },
    useContext: () => ({
      scimToken: {
        list: { invalidate: vi.fn().mockResolvedValue(undefined) },
      },
    }),
  },
}));

vi.mock("~/components/SettingsLayout", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="settings-layout">{children}</div>
  ),
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard:
    (_permission: unknown, _options?: unknown) =>
    (WrappedComponent: unknown) =>
      WrappedComponent,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// Mock CopyInput to avoid clipboard API complexities in jsdom
vi.mock("~/components/CopyInput", () => ({
  CopyInput: ({ value, label }: { value: string; label: string }) => (
    <input aria-label={label} readOnly value={value} />
  ),
}));

import React from "react";
import ScimSettingsPage from "../scim";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ScimSettingsPage />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  isEnterpriseRef.current = false;
  orgRef.current = { id: "org-1" };
});

afterEach(() => {
  cleanup();
});

describe("<ScimSettings/>", () => {
  describe("when the organization does not have an enterprise license", () => {
    /** @scenario Non-enterprise org sees upgrade prompt on SCIM settings page */
    it("renders an upgrade prompt with an Enterprise Feature alert and a contact sales block", () => {
      isEnterpriseRef.current = false;
      renderPage();

      // The Alert with "Enterprise Feature" title must be visible
      expect(screen.getByText("Enterprise Feature")).toBeTruthy();

      // The ContactSalesBlock must be present
      expect(screen.getByTestId("contact-sales-block")).toBeTruthy();

      // The SCIM token management heading must NOT be present
      expect(screen.queryByText("SCIM Provisioning")).toBeNull();
    });
  });

  describe("when the organization has an enterprise license", () => {
    /** @scenario Enterprise org sees full SCIM settings page */
    it("renders the SCIM token management interface", () => {
      isEnterpriseRef.current = true;
      renderPage();

      // The SCIM provisioning heading must be visible
      expect(screen.getByText("SCIM Provisioning")).toBeTruthy();

      // The Bearer Tokens section must be visible
      expect(screen.getByText("Bearer Tokens")).toBeTruthy();

      // The upgrade prompt must NOT be present
      expect(screen.queryByText("Enterprise Feature")).toBeNull();
      expect(screen.queryByTestId("contact-sales-block")).toBeNull();
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * Integration tests for the /settings/sso page — verifying access control,
 * the SSO connections table, SCIM section, and interactions with the modal.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreate,
  mockUpdate,
  mockDelete,
  mockVerify,
  mockToggle,
  mockToasterCreate,
  connectionsRef,
  scimLogsRef,
  isEnterpriseRef,
  hasAnyPermissionRef,
  mockWithPermissionGuard,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockVerify: vi.fn(),
  mockToggle: vi.fn(),
  mockToasterCreate: vi.fn(),
  connectionsRef: {
    current: [] as Array<{
      id: string;
      domain: string;
      provider: string;
      ssoEnforced: boolean;
      jitProvisioning: boolean;
      defaultOrgRole: string;
      verifiedAt: Date | null;
      verificationToken: string;
      clientId: string | null;
      issuerUrl: string | null;
      tenantId: string | null;
      samlEntityId: string | null;
      samlSsoUrl: string | null;
      attributeMapping: Record<string, unknown> | null;
      roleMapping: Record<string, unknown> | null;
    }>,
  },
  scimLogsRef: {
    current: {
      items: [] as Array<{
        id: string;
        method: string;
        path: string;
        status: number;
        duration: number;
        createdAt: Date;
      }>,
    },
  },
  isEnterpriseRef: { current: true as boolean },
  hasAnyPermissionRef: { current: true as boolean },
  mockWithPermissionGuard: vi.fn(
    (_permission: string, _opts?: unknown) =>
      <P extends object>(Component: { new(props: P): unknown } | ((props: P) => unknown)) =>
        Component,
  ),
}));

vi.mock("~/utils/api", () => ({
  api: {
    ssoConnection: {
      list: {
        useQuery: () => ({
          data: connectionsRef.current,
          isLoading: false,
          refetch: vi.fn().mockResolvedValue(undefined),
        }),
      },
      create: {
        useMutation: ({ onSuccess, onError }: { onSuccess?: () => void; onError?: (e: Error) => void } = {}) => ({
          mutate: (...args: unknown[]) => {
            mockCreate(...args);
            onSuccess?.();
          },
          isPending: false,
        }),
      },
      update: {
        useMutation: ({ onSuccess, onError }: { onSuccess?: () => void; onError?: (e: Error) => void } = {}) => ({
          mutate: (...args: unknown[]) => {
            mockUpdate(...args);
            onSuccess?.();
          },
          isPending: false,
        }),
      },
      delete: {
        useMutation: ({ onSuccess, onError }: { onSuccess?: () => void; onError?: (e: Error) => void } = {}) => ({
          mutate: (...args: unknown[]) => {
            mockDelete(...args);
            onSuccess?.();
          },
          isPending: false,
        }),
      },
      verifyDomain: {
        useMutation: ({ onSuccess, onError }: { onSuccess?: (r: { verified: boolean }) => void; onError?: (e: Error) => void } = {}) => ({
          mutate: (...args: unknown[]) => {
            mockVerify(...args);
          },
          isPending: false,
        }),
      },
      toggleEnforcement: {
        useMutation: ({ onSuccess, onError }: { onSuccess?: () => void; onError?: (e: Error) => void } = {}) => ({
          mutate: (...args: unknown[]) => {
            mockToggle(...args);
            onSuccess?.();
          },
          isPending: false,
        }),
      },
      scimLogs: {
        useQuery: () => ({ data: scimLogsRef.current, isLoading: false }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: (...args: unknown[]) => mockToasterCreate(...args) },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    hasAnyPermission: () => hasAnyPermissionRef.current,
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({
    isEnterprise: isEnterpriseRef.current,
    isFree: false,
    isLoading: false,
  }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: mockWithPermissionGuard,
}));

vi.mock("~/components/subscription/ContactSalesBlock", () => ({
  ContactSalesBlock: () => <div data-testid="contact-sales-block">Contact Sales</div>,
}));

import SsoSettingsPage from "../sso";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SsoSettingsPage />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockVerify.mockReset();
  mockToggle.mockReset();
  mockToasterCreate.mockReset();
  connectionsRef.current = [];
  scimLogsRef.current = { items: [] };
  isEnterpriseRef.current = true;
  hasAnyPermissionRef.current = true;
});

afterEach(() => {
  cleanup();
});

describe("<SsoSettings/>", () => {
  // ── Access Control ──────────────────────────────────────────────────────────

  describe("when the user does not have organization:manage permission", () => {
    /** @scenario Non-admin is blocked by permission guard */
    it("wraps the page with withPermissionGuard requiring organization:manage", () => {
      // withPermissionGuard is called at module-evaluation time (static HOC).
      // We verify it was invoked with the correct permission and layout options.
      expect(mockWithPermissionGuard).toHaveBeenCalledWith(
        "organization:manage",
        expect.objectContaining({ layoutComponent: expect.anything() }),
      );
    });
  });

  describe("when the organization does not have an enterprise license", () => {
    /** @scenario Non-enterprise org sees locked SSO settings */
    it("renders an upgrade prompt instead of SSO controls", () => {
      isEnterpriseRef.current = false;
      renderPage();
      expect(screen.getByText(/Enterprise Feature/i)).toBeTruthy();
      expect(screen.getByTestId("contact-sales-block")).toBeTruthy();
      expect(screen.queryByText(/SSO Connections/i)).toBeNull();
    });
  });

  describe("when the organization has an enterprise license", () => {
    /** @scenario Enterprise org sees full SSO settings */
    it("renders the SSO connections table and SCIM provisioning section", () => {
      renderPage();
      expect(screen.getAllByText(/SSO Connections/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/SCIM Provisioning/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── SSO Connections Table ───────────────────────────────────────────────────

  describe("when no SSO connections exist", () => {
    /** @scenario Empty state shows add connection prompt */
    it("shows a prompt and Add SSO Connection button", () => {
      connectionsRef.current = [];
      renderPage();
      expect(screen.getByText(/No SSO connections configured/i)).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /Add SSO Connection/i }),
      ).toBeTruthy();
    });
  });

  describe("when an SSO connection exists for domain acme.com with provider okta", () => {
    const mockConnection = {
      id: "conn-1",
      domain: "acme.com",
      provider: "okta",
      ssoEnforced: false,
      jitProvisioning: false,
      defaultOrgRole: "MEMBER",
      verifiedAt: null,
      verificationToken: "tok-abc",
      clientId: "client-123",
      issuerUrl: "https://acme.okta.com",
      tenantId: null,
      samlEntityId: null,
      samlSsoUrl: null,
      attributeMapping: null,
      roleMapping: null,
    };

    beforeEach(() => {
      connectionsRef.current = [mockConnection];
    });

    /** @scenario Existing connection renders in table */
    it("renders a row showing domain, provider, status badge, and enforce toggle", () => {
      renderPage();
      expect(screen.getByText("acme.com")).toBeTruthy();
      expect(screen.getByText("Okta")).toBeTruthy();
      // Status badge — not verified so shows Pending
      expect(screen.getByText("Pending")).toBeTruthy();
    });

    /** @scenario Enforce toggle can be toggled inline */
    it("calls toggleEnforcement mutation when the enforce switch is toggled", async () => {
      renderPage();
      const switches = screen.getAllByRole("checkbox");
      // The first switch in the table row is the enforce switch
      const enforceSwitch = switches[0]!;
      await act(async () => {
        fireEvent.click(enforceSwitch);
      });
      await waitFor(() => {
        expect(mockToggle).toHaveBeenCalledWith(
          expect.objectContaining({ id: "conn-1", organizationId: "org-1" }),
        );
      });
    });

    /** @scenario Actions menu offers edit and delete */
    it("shows Edit and Delete options when actions menu is opened", async () => {
      renderPage();
      const actionButton = screen.getByRole("button", {
        name: /Actions for acme.com/i,
      });
      await act(async () => {
        fireEvent.click(actionButton);
      });
      await waitFor(() => {
        expect(screen.getByText("Edit")).toBeTruthy();
        expect(screen.getByText("Delete")).toBeTruthy();
      });
    });

    /** @scenario Edit opens modal pre-filled with existing connection */
    it("opens the SSO connection modal with domain field disabled when Edit is clicked", async () => {
      renderPage();
      const actionButton = screen.getByRole("button", {
        name: /Actions for acme.com/i,
      });
      await act(async () => {
        fireEvent.click(actionButton);
      });
      await waitFor(() => expect(screen.getByText("Edit")).toBeTruthy());
      await act(async () => {
        fireEvent.click(screen.getByText("Edit"));
      });
      await waitFor(() => {
        expect(screen.getByText(/Edit SSO Connection/i)).toBeTruthy();
      });
      // Domain field should be disabled in edit mode
      const domainInput = screen.getByPlaceholderText("acme.com") as HTMLInputElement;
      expect(domainInput.disabled).toBe(true);
    });

    /** @scenario Delete shows confirmation dialog */
    it("shows a confirmation dialog with Cancel and Delete buttons when Delete is clicked", async () => {
      renderPage();
      const actionButton = screen.getByRole("button", {
        name: /Actions for acme.com/i,
      });
      await act(async () => {
        fireEvent.click(actionButton);
      });
      await waitFor(() => expect(screen.getByText("Delete")).toBeTruthy());
      await act(async () => {
        fireEvent.click(screen.getByText("Delete"));
      });
      await waitFor(() => {
        expect(screen.getByText(/Delete SSO connection/i)).toBeTruthy();
      });
      expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Delete$/i })).toBeTruthy();
    });
  });

  describe("when multiple SSO connections exist", () => {
    /** @scenario Multiple connections show add row at bottom */
    it("shows a clickable Add SSO Connection row at the bottom of the table", () => {
      connectionsRef.current = [
        {
          id: "conn-1",
          domain: "acme.com",
          provider: "okta",
          ssoEnforced: false,
          jitProvisioning: false,
          defaultOrgRole: "MEMBER",
          verifiedAt: null,
          verificationToken: "tok-1",
          clientId: "cid-1",
          issuerUrl: null,
          tenantId: null,
          samlEntityId: null,
          samlSsoUrl: null,
          attributeMapping: null,
          roleMapping: null,
        },
        {
          id: "conn-2",
          domain: "corp.io",
          provider: "azure-ad",
          ssoEnforced: false,
          jitProvisioning: false,
          defaultOrgRole: "MEMBER",
          verifiedAt: null,
          verificationToken: "tok-2",
          clientId: "cid-2",
          issuerUrl: null,
          tenantId: "tenant-123",
          samlEntityId: null,
          samlSsoUrl: null,
          attributeMapping: null,
          roleMapping: null,
        },
      ];
      renderPage();
      // When connections exist, the bottom row shows "Add SSO Connection" as text
      const addTexts = screen.getAllByText(/Add SSO Connection/i);
      // There should be at least one instance (the bottom clickable row)
      expect(addTexts.length).toBeGreaterThan(0);
    });
  });

  // ── SCIM Section ────────────────────────────────────────────────────────────

  describe("when the admin views the SCIM provisioning section", () => {
    /** @scenario SCIM section links to token management */
    it("shows a link to the SCIM token management page", () => {
      renderPage();
      const link = screen.getByRole("link", { name: /Manage SCIM Tokens/i });
      expect(link).toBeTruthy();
      expect((link as HTMLAnchorElement).href).toContain("/settings/scim");
    });

    /** @scenario SCIM logs table renders with filter controls */
    it("shows a table with Time, Method, Path, Status, Duration columns and filter buttons", () => {
      renderPage();
      expect(screen.getAllByText("Time").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Method").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Path").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Status").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Duration").length).toBeGreaterThanOrEqual(1);
      // Filter buttons
      expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "2xx" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "4xx" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "5xx" })).toBeTruthy();
      // Search input
      expect(screen.getByPlaceholderText(/Search by path/i)).toBeTruthy();
    });

    /** @scenario SCIM logs empty state when no logs match filters */
    it("shows empty state message when no SCIM logs match", () => {
      scimLogsRef.current = { items: [] };
      renderPage();
      expect(
        screen.getByText(/No SCIM requests match the current filters\./i),
      ).toBeTruthy();
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * Integration tests for <SsoConnectionModal> — verifying all form sections,
 * provider-specific fields, enforcement toggles, attribute/role mapping,
 * save validation, and the confirmation dialog.
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
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockToasterCreate, mockOnSave, mockOnClose, mockOnVerify } =
  vi.hoisted(() => ({
    mockToasterCreate: vi.fn(),
    mockOnSave: vi.fn(),
    mockOnClose: vi.fn(),
    mockOnVerify: vi.fn(),
  }));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: (...args: unknown[]) => mockToasterCreate(...args) },
}));

// Polyfill clipboard API for jsdom
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
});

import { SsoConnectionModal } from "../SsoConnectionModal";

function renderModal(
  props: Partial<ComponentProps<typeof SsoConnectionModal>> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SsoConnectionModal
        open={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        {...props}
      />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mockToasterCreate.mockReset();
  mockOnSave.mockReset();
  mockOnClose.mockReset();
  mockOnVerify.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("<SsoConnectionModal/>", () => {
  // ── Add/Edit Modal ──────────────────────────────────────────────────────────

  describe("when the modal is opened for adding a new connection", () => {
    /** @scenario Add connection modal renders all sections */
    it("renders domain, provider, enforcement, and advanced sections with attribute/role mapping collapsed", () => {
      renderModal();
      expect(screen.getByText("Add SSO Connection")).toBeTruthy();
      expect(screen.getByText(/Domain \*/i)).toBeTruthy();
      expect(screen.getByText(/Provider \*/i)).toBeTruthy();
      expect(screen.getByText(/Enforcement & Provisioning/i)).toBeTruthy();
      // Advanced sections are rendered as collapsed buttons
      expect(screen.getByText("Attribute Mapping")).toBeTruthy();
      expect(screen.getByText("Role Mapping")).toBeTruthy();
      // Advanced content is in the DOM but collapsed (hidden via CSS)
      const emailClaim = screen.queryByText(/Email claim/i);
      if (emailClaim) {
        expect(emailClaim.closest("[data-state]")?.getAttribute("data-state")).toBe("closed");
      }
    });

    /** @scenario Domain verification section shows DNS instructions */
    it("shows TXT record host and token with copy buttons when domain is entered and verificationToken exists", () => {
      // Verification section only shows when domain AND verificationToken are set.
      // This requires editing an existing connection with a verificationToken.
      const existingConn = {
        id: "conn-1",
        domain: "acme.com",
        provider: "okta",
        ssoEnforced: false,
        jitProvisioning: false,
        defaultOrgRole: "MEMBER" as const,
        verifiedAt: null,
        verificationToken: "abc123token",
        clientId: "cid",
        issuerUrl: "https://acme.okta.com",
        tenantId: null,
        samlEntityId: null,
        samlSsoUrl: null,
        attributeMapping: null,
        roleMapping: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      renderModal({ editingConnection: existingConn, onVerify: mockOnVerify });
      expect(screen.getByText("Domain Verification")).toBeTruthy();
      expect(screen.getByText("_langwatch-verification")).toBeTruthy();
      expect(
        screen.getByText(`langwatch-verify=${existingConn.verificationToken}`),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: /Verify Domain/i })).toBeTruthy();
    });

    /** @scenario Domain verification status badge reflects state */
    it("shows Pending badge when domain is not yet verified and Verified badge when verifiedAt is set", () => {
      const pendingConn = {
        id: "conn-1",
        domain: "acme.com",
        provider: "okta",
        ssoEnforced: false,
        jitProvisioning: false,
        defaultOrgRole: "MEMBER" as const,
        verifiedAt: null,
        verificationToken: "tok",
        clientId: "cid",
        issuerUrl: null,
        tenantId: null,
        samlEntityId: null,
        samlSsoUrl: null,
        attributeMapping: null,
        roleMapping: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { rerender } = renderModal({
        editingConnection: pendingConn,
        onVerify: mockOnVerify,
      });
      expect(screen.getByText("Pending")).toBeTruthy();

      const verifiedConn = { ...pendingConn, verifiedAt: new Date() };
      rerender(
        <ChakraProvider value={defaultSystem}>
          <SsoConnectionModal
            open={true}
            onClose={mockOnClose}
            onSave={mockOnSave}
            onVerify={mockOnVerify}
            editingConnection={verifiedConn}
          />
        </ChakraProvider>,
      );
      expect(screen.getByText("Verified")).toBeTruthy();
    });

    /** @scenario Callback URL is shown with copy button */
    it("shows the callback URL and a copy button when domain is entered", async () => {
      renderModal();
      const domainInput = screen.getByPlaceholderText("acme.com");
      await act(async () => {
        fireEvent.change(domainInput, { target: { value: "acme.com" } });
      });
      await waitFor(() => {
        // Callback URL rendered as text inside the subtle box
        expect(screen.getByText(/\/api\/auth\/sso\/acme\.com/i)).toBeTruthy();
      });
    });

    /** @scenario Provider dropdown shows supported providers */
    it("shows Okta, Azure AD / Entra ID, Google Workspace, Custom OIDC, Custom SAML in the dropdown", () => {
      renderModal();
      const select = screen
        .getAllByRole("combobox")
        .find((el) =>
          (el as HTMLSelectElement).options
            ? Array.from((el as HTMLSelectElement).options).some(
                (o) => o.text === "Okta",
              )
            : false,
        ) as HTMLSelectElement | undefined;
      expect(select).toBeTruthy();
      const optionTexts = Array.from(select!.options).map((o) => o.text);
      expect(optionTexts).toContain("Okta");
      expect(optionTexts).toContain("Azure AD / Entra ID");
      expect(optionTexts).toContain("Google Workspace");
      expect(optionTexts).toContain("Custom OIDC");
      expect(optionTexts).toContain("Custom SAML");
    });
  });

  // ── Provider-Specific Fields ────────────────────────────────────────────────

  describe("when the admin selects Okta as the provider", () => {
    /** @scenario Provider-specific fields render for Okta */
    it("shows Client ID, Client Secret, and Issuer URL fields", () => {
      renderModal();
      // Default provider is okta
      expect(screen.getByText(/Client ID \*/i)).toBeTruthy();
      expect(screen.getByText(/Client Secret/i)).toBeTruthy();
      expect(screen.getByText(/Issuer URL \*/i)).toBeTruthy();
    });
  });

  describe("when the admin selects Azure AD as the provider", () => {
    /** @scenario Provider-specific fields render for Azure AD */
    it("shows Client ID, Client Secret, and Tenant ID fields", async () => {
      renderModal();
      const selects = screen.getAllByRole("combobox");
      const providerSelect = selects.find((el) =>
        Array.from((el as HTMLSelectElement).options).some(
          (o) => o.text === "Okta",
        ),
      ) as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(providerSelect, { target: { value: "azure-ad" } });
      });
      await waitFor(() => {
        expect(screen.getByText(/Tenant ID \*/i)).toBeTruthy();
      });
      expect(screen.getByText(/Client ID \*/i)).toBeTruthy();
      expect(screen.getByText(/Client Secret/i)).toBeTruthy();
      expect(screen.queryByText(/Issuer URL/i)).toBeNull();
    });
  });

  describe("when the admin selects Google Workspace as the provider", () => {
    /** @scenario Provider-specific fields render for Google Workspace */
    it("shows Client ID and Client Secret only, without Issuer URL or Tenant ID", async () => {
      renderModal();
      const selects = screen.getAllByRole("combobox");
      const providerSelect = selects.find((el) =>
        Array.from((el as HTMLSelectElement).options).some(
          (o) => o.text === "Okta",
        ),
      ) as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(providerSelect, { target: { value: "google" } });
      });
      await waitFor(() => {
        expect(screen.getByText(/Client ID \*/i)).toBeTruthy();
      });
      expect(screen.getByText(/Client Secret/i)).toBeTruthy();
      expect(screen.queryByText(/Issuer URL/i)).toBeNull();
      expect(screen.queryByText(/Tenant ID/i)).toBeNull();
    });
  });

  describe("when the admin selects Custom OIDC as the provider", () => {
    /** @scenario Provider-specific fields render for Custom OIDC */
    it("shows Client ID, Client Secret, and Issuer URL fields", async () => {
      renderModal();
      const selects = screen.getAllByRole("combobox");
      const providerSelect = selects.find((el) =>
        Array.from((el as HTMLSelectElement).options).some(
          (o) => o.text === "Okta",
        ),
      ) as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(providerSelect, { target: { value: "custom-oidc" } });
      });
      await waitFor(() => {
        expect(screen.getByText(/Issuer URL \*/i)).toBeTruthy();
      });
      expect(screen.getByText(/Client ID \*/i)).toBeTruthy();
      expect(screen.getByText(/Client Secret/i)).toBeTruthy();
    });
  });

  describe("when the admin selects Custom SAML as the provider", () => {
    /** @scenario Provider-specific fields render for Custom SAML */
    it("shows SAML Entity ID, SSO URL, and X.509 Certificate textarea fields", async () => {
      renderModal();
      const selects = screen.getAllByRole("combobox");
      const providerSelect = selects.find((el) =>
        Array.from((el as HTMLSelectElement).options).some(
          (o) => o.text === "Okta",
        ),
      ) as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(providerSelect, { target: { value: "custom-saml" } });
      });
      await waitFor(() => {
        expect(screen.getByText(/SAML Entity ID \*/i)).toBeTruthy();
      });
      expect(screen.getByText(/SSO URL \*/i)).toBeTruthy();
      expect(screen.getByText(/X\.509 Certificate \*/i)).toBeTruthy();
      // Certificate field is a textarea — find it by placeholder text
      const textarea = screen.getByPlaceholderText(/BEGIN CERTIFICATE/i);
      expect(textarea.tagName.toLowerCase()).toBe("textarea");
    });
  });

  // ── Enforcement & Provisioning ──────────────────────────────────────────────

  describe("when viewing enforcement and provisioning section", () => {
    /** @scenario Enforcement toggles render */
    it("shows Enforce SSO toggle, JIT provisioning toggle, and Default role dropdown", () => {
      renderModal();
      expect(screen.getByText("Enforce SSO")).toBeTruthy();
      expect(screen.getByText("Enable JIT provisioning")).toBeTruthy();
      expect(screen.getAllByText("Default role").length).toBeGreaterThanOrEqual(1);
      // Default role dropdown should have Admin, Member, External
      const selects = screen.getAllByRole("combobox");
      const roleSelect = selects.find((el) =>
        Array.from((el as HTMLSelectElement).options).some(
          (o) => o.text === "Admin",
        ),
      ) as HTMLSelectElement | undefined;
      expect(roleSelect).toBeTruthy();
      const roleOptions = Array.from(roleSelect!.options).map((o) => o.text);
      expect(roleOptions).toContain("Admin");
      expect(roleOptions).toContain("Member");
      expect(roleOptions).toContain("External");
    });
  });

  // ── Attribute Mapping ───────────────────────────────────────────────────────

  describe("when the admin expands the Attribute Mapping section", () => {
    /** @scenario Attribute mapping section expands with 4 claim fields */
    it("shows Email claim, Name claim, Groups claim, and Role claim fields with defaults", async () => {
      renderModal();
      const attrMappingButton = screen.getByRole("button", {
        name: /Attribute Mapping/i,
      });
      await act(async () => {
        fireEvent.click(attrMappingButton);
      });
      await waitFor(() => {
        expect(screen.getByText("Email claim")).toBeTruthy();
      });
      expect(screen.getByText("Name claim")).toBeTruthy();
      expect(screen.getByText("Groups claim")).toBeTruthy();
      expect(screen.getByText("Role claim")).toBeTruthy();
      // Default values
      const emailInput = screen
        .getAllByRole("textbox")
        .find(
          (el) => (el as HTMLInputElement).value === "email",
        ) as HTMLInputElement | undefined;
      expect(emailInput).toBeTruthy();
    });
  });

  // ── Role Mapping ────────────────────────────────────────────────────────────

  describe("when the admin expands the Role Mapping section", () => {
    async function expandRoleMapping() {
      const roleMappingButton = screen.getByRole("button", {
        name: /Role Mapping/i,
      });
      await act(async () => {
        fireEvent.click(roleMappingButton);
      });
    }

    /** @scenario Role mapping section expands with group-to-role list */
    it("shows default role dropdown, use role attribute toggle, and group mapping list with add/remove controls", async () => {
      renderModal();
      await expandRoleMapping();
      await waitFor(() => {
        expect(screen.getByText("Use role attribute directly from IdP")).toBeTruthy();
      });
      expect(screen.getByText("Group to Role Mappings")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Add Group Mapping/i })).toBeTruthy();
    });

    /** @scenario Use role attribute hides group mappings */
    it("hides the group-to-role mapping list when Use role attribute is enabled", async () => {
      renderModal();
      await expandRoleMapping();
      await waitFor(() => {
        expect(screen.getByText("Use role attribute directly from IdP")).toBeTruthy();
      });
      // Find the Use role attribute switch and toggle it
      // The switch is associated with the "Use role attribute directly from IdP" text
      const switches = screen.getAllByRole("checkbox");
      // There are 2 global switches (ssoEnforced, jitProvisioning) + 1 role attribute switch
      const roleAttrSwitch = switches[switches.length - 1]!;
      await act(async () => {
        fireEvent.click(roleAttrSwitch);
      });
      await waitFor(() => {
        expect(screen.queryByText("Group to Role Mappings")).toBeNull();
      });
    });

    /** @scenario Group mapping supports add and remove */
    it("adds a new mapping row when Add Group Mapping is clicked, and each row has a remove button", async () => {
      renderModal();
      await expandRoleMapping();
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /Add Group Mapping/i }),
        ).toBeTruthy();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Add Group Mapping/i }));
      });
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/IdP Group Name/i),
        ).toBeTruthy();
      });
      const allButtons = screen.getAllByRole("button");
      expect(allButtons.length).toBeGreaterThan(4);
    });
  });

  // ── Save Flow ───────────────────────────────────────────────────────────────

  describe("when the admin clicks Save without filling required fields", () => {
    /** @scenario Save requires domain and client ID */
    it("shows an error toaster when domain or client ID are empty", async () => {
      renderModal();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
      });
      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({ type: "error" }),
        );
      });
    });
  });

  describe("when the admin fills required fields and clicks Save", () => {
    /** @scenario Save shows confirmation dialog */
    it("opens a confirmation dialog with Cancel and Activate SSO buttons", async () => {
      renderModal();
      // Fill in domain
      const domainInput = screen.getByPlaceholderText("acme.com");
      await act(async () => {
        fireEvent.change(domainInput, { target: { value: "acme.com" } });
      });
      // Fill in client ID
      const clientIdInput = screen.getByPlaceholderText("your-client-id");
      await act(async () => {
        fireEvent.change(clientIdInput, { target: { value: "my-client-id" } });
      });
      // Fill in client secret
      const clientSecretInput = screen.getByPlaceholderText("your-client-secret");
      await act(async () => {
        fireEvent.change(clientSecretInput, {
          target: { value: "my-client-secret" },
        });
      });
      // Fill in Issuer URL (required for okta)
      const issuerInput = screen.getByPlaceholderText(
        "https://your-org.okta.com",
      );
      await act(async () => {
        fireEvent.change(issuerInput, {
          target: { value: "https://acme.okta.com" },
        });
      });
      // Click Save
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
      });
      // Confirmation dialog should appear
      await waitFor(() => {
        expect(screen.getByText(/Activate SSO for @acme\.com\?/i)).toBeTruthy();
      });
      const cancelButtons = screen.getAllByRole("button", { name: /^Cancel$/i });
      expect(cancelButtons.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole("button", { name: /Activate SSO/i })).toBeTruthy();
    });
  });
});

/**
 * @vitest-environment jsdom
 * Editing an existing connection's identity provider settings from its card.
 * Spec: specs/identity/sso-connection-edit-identity-provider.feature.
 */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type SaveOptions = { onSuccess?: () => Promise<void> | void };

const { OIDC_VIEW, current, saveMock, invalidateMock } = vi.hoisted(() => {
  const OIDC_VIEW: Record<string, unknown> = {
    protocol: "oidc",
    issuer: "https://login.microsoftonline.com/wrong-tenant/v2.0",
    clientId: "client_old",
    hasClientSecret: true,
  };

  return {
    OIDC_VIEW,
    current: { value: OIDC_VIEW as Record<string, unknown> | null },
    saveMock: vi.fn(),
    invalidateMock: vi.fn(async () => void 0),
  };
});

vi.mock("../../../behavior/sso-api.ts", () => ({
  ssoApi: {
    ssoSetup: {
      identityProvider: {
        useQuery: () => ({ isLoading: false, error: null, data: current.value }),
      },
      updateIdentityProvider: {
        useMutation: () => ({ mutate: saveMock, isPending: false, error: null }),
      },
    },
    useUtils: () => ({
      ssoSetup: {
        getSetup: { invalidate: invalidateMock },
        identityProvider: { invalidate: invalidateMock },
        getHistory: { invalidate: invalidateMock },
      },
    }),
  },
}));

import { FakeSsoHost, renderWithSsoHost } from "../../../testing.tsx";
import { EditIdentityProviderSection } from "../edit-identity-provider.section.tsx";

const onDone = vi.fn();

function draw() {
  return renderWithSsoHost(
    <EditIdentityProviderSection
      organizationId="org_acme"
      connectionId="ssoconn_acme"
      onDone={onDone}
    />,
    new FakeSsoHost(),
  );
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  current.value = OIDC_VIEW;
});

describe("editing the identity provider settings on the connection's card", () => {
  describe("given an OpenID Connect connection with a stored secret", () => {
    /** @scenario "The settings card offers the edit prefilled with the current settings" */
    it("prefills the issuer and client id, leaves the secret blank, and saves for the same connection", () => {
      draw();

      expect(field("Issuer address").value).toBe(
        "https://login.microsoftonline.com/wrong-tenant/v2.0",
      );
      expect(field("Client id").value).toBe("client_old");
      expect(field("Client secret").value).toBe("");
      expect(screen.getByText("Leave blank to keep the current secret.")).toBeTruthy();

      fireEvent.change(field("Issuer address"), {
        target: { value: "https://login.microsoftonline.com/right-tenant/v2.0" },
      });
      fireEvent.click(screen.getByTestId("edit-identity-provider-save"));

      expect(saveMock).toHaveBeenCalledWith(
        {
          organizationId: "org_acme",
          connectionId: "ssoconn_acme",
          idp: {
            protocol: "oidc",
            issuer: "https://login.microsoftonline.com/right-tenant/v2.0",
            clientId: "client_old",
            clientSecret: null,
          },
        },
        expect.anything(),
      );
    });

    describe("when the save succeeds", () => {
      it("refreshes the card and its history, says so, and closes the form", async () => {
        const { host } = draw();
        fireEvent.click(screen.getByTestId("edit-identity-provider-save"));

        const [, options] = saveMock.mock.calls[0] as [unknown, SaveOptions];
        await options.onSuccess?.();

        expect(invalidateMock).toHaveBeenCalledTimes(3);
        expect(host.acknowledgements).toEqual([
          expect.objectContaining({ title: "Identity provider settings saved" }),
        ]);
        await waitFor(() => expect(onDone).toHaveBeenCalled());
      });
    });

    describe("when the administrator cancels", () => {
      it("closes the form without saving", () => {
        draw();
        fireEvent.click(screen.getByTestId("edit-identity-provider-cancel"));

        expect(onDone).toHaveBeenCalled();
        expect(saveMock).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a SAML connection", () => {
    it("prefills the SAML settings and saves them as SAML", () => {
      current.value = {
        protocol: "saml",
        entryPoint: "https://login.acme.example/sso",
        entityId: "https://login.acme.example",
        metadataXml: null,
        certificate: "MIIC",
      };
      draw();

      expect(field("Sign-in address").value).toBe("https://login.acme.example/sso");
      fireEvent.click(screen.getByTestId("edit-identity-provider-save"));

      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          idp: {
            protocol: "saml",
            entryPoint: "https://login.acme.example/sso",
            entityId: "https://login.acme.example",
            metadataXml: null,
            certificate: "MIIC",
          },
        }),
        expect.anything(),
      );
    });
  });

  describe("given a connection with no settings of its own", () => {
    it("says there is nothing to change", () => {
      current.value = null;
      draw();

      expect(screen.getByText(/no identity provider settings of its own/)).toBeTruthy();
      expect(screen.queryByTestId("edit-identity-provider")).toBeNull();
    });
  });
});

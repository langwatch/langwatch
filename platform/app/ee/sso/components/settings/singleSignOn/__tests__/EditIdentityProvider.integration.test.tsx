/**
 * @vitest-environment jsdom
 *
 * Editing an existing connection's identity provider settings from its card
 * (specs/identity/sso-connection-edit-identity-provider.feature).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { OIDC_VIEW, current, saveMock, invalidateMock, toastMock } = vi.hoisted(
  () => {
    const OIDC_VIEW: Record<string, unknown> = {
      protocol: "oidc",
      issuer: "https://login.microsoftonline.com/wrong-tenant/v2.0",
      clientId: "client_old",
      hasClientSecret: true,
    };
    return {
      OIDC_VIEW,
      current: { value: OIDC_VIEW },
      saveMock: vi.fn(),
      invalidateMock: vi.fn(async () => undefined),
      toastMock: vi.fn(),
    };
  },
);

vi.mock("~/features/errors/logic/presentation", () => ({
  explainAnyError: () => ({ title: "t", describe: () => "d" }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: toastMock },
}));

vi.mock("~/utils/api", () => ({
  api: {
    ssoSetup: {
      identityProvider: {
        useQuery: () => ({
          isLoading: false,
          error: null,
          data: current.value,
        }),
      },
      updateIdentityProvider: {
        useMutation: () => ({
          mutate: saveMock,
          isPending: false,
          error: null,
        }),
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

import { EditIdentityProvider } from "../EditIdentityProvider";

const onDone = vi.fn();

function draw() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EditIdentityProvider
        organizationId="org_acme"
        connectionId="ssoconn_acme"
        onDone={onDone}
      />
    </ChakraProvider>,
  );
}

const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  current.value = OIDC_VIEW;
});

describe("editing the identity provider settings on the connection's card", () => {
  describe("given an OpenID Connect connection with a stored secret", () => {
    /** @scenario "The settings card offers the edit prefilled with the current settings" */
    it("prefills the issuer and client id, leaves the secret blank, and saves for the same connection", async () => {
      draw();

      expect(field("Issuer address").value).toBe(
        "https://login.microsoftonline.com/wrong-tenant/v2.0",
      );
      expect(field("Client id").value).toBe("client_old");
      expect(field("Client secret").value).toBe("");
      expect(
        screen.getByText("Leave blank to keep the current secret."),
      ).toBeTruthy();

      fireEvent.change(field("Issuer address"), {
        target: {
          value: "https://login.microsoftonline.com/right-tenant/v2.0",
        },
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
        draw();
        fireEvent.click(screen.getByTestId("edit-identity-provider-save"));

        const [, options] = saveMock.mock.calls[0] as [
          unknown,
          { onSuccess: () => Promise<void> },
        ];
        await options.onSuccess();

        expect(invalidateMock).toHaveBeenCalledTimes(3);
        expect(toastMock).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Identity provider settings saved",
          }),
        );
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

      expect(field("Sign-in address").value).toBe(
        "https://login.acme.example/sso",
      );
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
});

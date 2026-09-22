/**
 * @vitest-environment jsdom
 * Registering as an administrator meets it: the recognition question first,
 * their console's side second, and only then the values it handed back.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = {
  input: { organizationId: string; providerId: string; idp: Record<string, unknown> };
  options?: { onSuccess?: () => void | Promise<void>; onError?: (error: unknown) => void };
};

const { state } = vi.hoisted(() => ({
  state: { calls: [] as Call[], migrations: [] as Call[], refusal: null as unknown },
}));

vi.mock("../../../behavior/sso-api.ts", () => {
  // Success is driven by the test, because when the press is over is exactly
  // what one of them is about.
  const recorder = (calls: Call[]) => ({
    useMutation: () => ({
      isPending: false,
      // What the last attempt was refused with, which is what the section
      // renders beside its button.
      error: state.refusal,
      mutate: (input: Call["input"], options?: Call["options"]) => {
        calls.push({ input, options });
        if (state.refusal) options?.onError?.(state.refusal);
      },
    }),
  });

  return {
    ssoApi: {
      ssoSetup: {
        register: recorder(state.calls),
        startLegacyMigration: recorder(state.migrations),
      },
    },
  };
});

import { FakeSsoHost, renderWithSsoHost } from "../../../testing.tsx";
import { RegisterConnectionSection } from "../register-connection.section.tsx";

const SERVICE_PROVIDER = {
  redirectUrl: "https://app.test/api/auth/sso/callback/{connectionId}",
  assertionConsumerServiceUrl: "https://app.test/api/auth/sso/saml2/sp/acs/{connectionId}",
  singleLogoutUrl: "https://app.test/api/auth/sso/saml2/sp/slo/{connectionId}",
  entityId: "https://app.test/api/auth/sso/saml2/sp/metadata/{connectionId}",
  metadataUrl: "https://app.test/api/auth/sso/saml2/sp/metadata/{connectionId}",
};

function renderSection(
  overrides: {
    canManage?: boolean;
    replacesConnectionId?: string;
    onRegistered?: () => Promise<unknown> | void;
  } = {},
) {
  return renderWithSsoHost(
    <RegisterConnectionSection
      organizationId="org-1"
      serviceProvider={SERVICE_PROVIDER}
      canManage={overrides.canManage ?? true}
      replacesConnectionId={overrides.replacesConnectionId}
      onRegistered={overrides.onRegistered}
    />,
    new FakeSsoHost({ canManage: overrides.canManage ?? true }),
  );
}

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  state.calls.length = 0;
  state.migrations.length = 0;
  state.refusal = null;
});

afterEach(cleanup);

describe("registering an identity provider", () => {
  describe("given nobody has been picked yet", () => {
    it("asks only the question the administrator can answer", () => {
      renderSection();

      expect(screen.getByText("Who signs your team in?")).toBeInTheDocument();
      expect(screen.queryByTestId("sso-register-credentials")).toBeNull();
      expect(screen.queryByTestId("sso-register-console")).toBeNull();
    });
  });

  describe("given a product somebody recognises", () => {
    it("points at where in that console the application is created", () => {
      renderSection();

      fireEvent.click(screen.getByTestId("identity-provider-okta"));

      expect(
        screen.getByText(/In Okta, create the app under Applications → Create App Integration/),
      ).toBeInTheDocument();
      expect(screen.getByTestId("service-provider")).toBeInTheDocument();
    });

    it("prefills the connection's name and pre-answers the protocol without hiding it", () => {
      renderSection();

      fireEvent.click(screen.getByTestId("identity-provider-okta"));

      expect(screen.getByLabelText("Connection name")).toHaveValue("Okta");
      expect(screen.getByTestId("sso-protocol-oidc")).toHaveAttribute("aria-pressed", "true");
    });

    it("moves the prefilled name on to the next product picked", () => {
      renderSection();

      fireEvent.click(screen.getByTestId("identity-provider-okta"));
      fireEvent.click(screen.getByTestId("identity-provider-entra"));

      expect(screen.getByLabelText("Connection name")).toHaveValue("Microsoft Entra ID");
    });

    it("keeps a name the administrator typed over every later pick", () => {
      renderSection();

      fireEvent.click(screen.getByTestId("identity-provider-okta"));
      fill("Connection name", "Corporate sign-in");
      fireEvent.click(screen.getByTestId("identity-provider-entra"));

      expect(screen.getByLabelText("Connection name")).toHaveValue("Corporate sign-in");
    });

    /** @scenario "The administrator chooses which kind of provider they have" */
    it("asks a product's protocol question, because the tile only pre-answered it", () => {
      renderSection();

      fireEvent.click(screen.getByTestId("identity-provider-google"));

      expect(screen.getByTestId("sso-protocol-choice")).toBeInTheDocument();
      expect(screen.getByTestId("sso-protocol-saml")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByLabelText("Sign-in address")).toBeInTheDocument();
      expect(screen.getByLabelText("Metadata")).toBeInTheDocument();
      expect(screen.getByLabelText("Signing certificate")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("sso-protocol-oidc"));

      expect(screen.getByLabelText("Issuer address")).toBeInTheDocument();
      expect(screen.getByLabelText("Client id")).toBeInTheDocument();
      expect(screen.getByLabelText("Client secret")).toBeInTheDocument();
    });
  });

  describe("given the boxes each protocol needs", () => {
    /** @scenario "The administrator chooses which kind of provider they have" */
    it("asks for an issuer, a client id and a client secret by default", () => {
      renderSection();

      fireEvent.click(screen.getByTestId("identity-provider-okta"));

      expect(screen.getByLabelText("Issuer address")).toBeInTheDocument();
      expect(screen.getByLabelText("Client id")).toBeInTheDocument();
      expect(screen.getByLabelText("Client secret")).toBeInTheDocument();
    });

    /** @scenario "The administrator chooses which kind of provider they have" */
    it("asks for metadata, or a sign-in address and certificate, once SAML is chosen", () => {
      renderSection();

      fireEvent.click(screen.getByTestId("identity-provider-saml"));

      expect(screen.getByLabelText("Sign-in address")).toBeInTheDocument();
      expect(screen.getByLabelText("Metadata")).toBeInTheDocument();
      expect(screen.getByLabelText("Entity id")).toBeInTheDocument();
      expect(screen.getByLabelText("Signing certificate")).toBeInTheDocument();
    });
  });

  describe("given a reader who arrived holding a protocol", () => {
    it("does not ask again under the tile they just pressed", () => {
      renderSection();

      fireEvent.click(screen.getByTestId("identity-provider-saml"));

      expect(screen.queryByTestId("sso-protocol-choice")).toBeNull();
      expect(screen.getByLabelText("Metadata")).toBeInTheDocument();
    });
  });

  describe("when the values from the console come back", () => {
    it("sends OpenID Connect's issuer and client credential under the name on the card", () => {
      renderSection();

      fireEvent.click(screen.getByTestId("identity-provider-okta"));
      fill("Issuer address", "https://acme.okta.com");
      fill("Client id", "0oa1");
      fill("Client secret", "s3cret");
      fireEvent.click(screen.getByTestId("sso-register"));

      expect(state.calls).toHaveLength(1);
      expect(state.calls[0]?.input).toEqual({
        organizationId: "org-1",
        providerId: "Okta",
        idp: {
          protocol: "oidc",
          issuer: "https://acme.okta.com",
          clientId: "0oa1",
          clientSecret: "s3cret",
        },
      });
    });

    it("sends SAML's evidence, with the boxes nobody filled as null", () => {
      renderSection();

      fireEvent.click(screen.getByTestId("identity-provider-saml"));
      fill("Connection name", "Corporate sign-in");
      fill("Sign-in address", "https://sso.acme.com/saml2/sso");
      fill("Metadata", "<EntityDescriptor />");
      fireEvent.click(screen.getByTestId("sso-register"));

      expect(state.calls[0]?.input.idp).toEqual({
        protocol: "saml",
        entryPoint: "https://sso.acme.com/saml2/sso",
        entityId: null,
        metadataXml: "<EntityDescriptor />",
        certificate: null,
      });
    });

    /** @scenario "Registering is acknowledged rather than left to be inferred" */
    it("is not over until the page holds the connection, so nobody registers twice", async () => {
      let refreshed = 0;
      let readAnswers: () => void = () => {};
      const read = new Promise<void>((resolve) => {
        readAnswers = resolve;
      });
      const { host } = renderSection({
        onRegistered: () =>
          read.then(() => {
            refreshed += 1;
          }),
      });

      fireEvent.click(screen.getByTestId("identity-provider-saml"));
      fill("Sign-in address", "https://sso.acme.com/saml2/sso");
      fireEvent.click(screen.getByTestId("sso-register"));
      const press = Promise.resolve(state.calls[0]?.options?.onSuccess?.());
      let over = false;
      void press.then(() => {
        over = true;
      });
      await Promise.resolve();

      expect(over).toBe(false);
      expect(host.acknowledgements).toEqual([]);

      readAnswers();
      await press;

      expect(refreshed).toBe(1);
      expect(host.acknowledgements).toEqual([
        {
          title: "Identity provider registered",
          description: "Next, prove you own the domain your people sign in with.",
        },
      ]);
    });
  });

  describe("when the registration replaces the connection in use", () => {
    /** @scenario "Registering is acknowledged rather than left to be inferred" */
    it("starts the cutover instead, and says the current sign-in keeps working", async () => {
      const { host } = renderSection({ replacesConnectionId: "ssoc_legacy" });

      fireEvent.click(screen.getByTestId("identity-provider-saml"));
      fill("Connection name", "Corporate sign-in");
      fill("Sign-in address", "https://sso.acme.com/saml2/sso");
      fireEvent.click(screen.getByText("Register replacement"));
      await state.migrations[0]?.options?.onSuccess?.();

      expect(state.calls).toEqual([]);
      expect(state.migrations[0]?.input).toMatchObject({
        organizationId: "org-1",
        legacyConnectionId: "ssoc_legacy",
        providerId: "Corporate sign-in",
      });
      expect(host.acknowledgements).toEqual([
        {
          title: "Replacement registered",
          description: "Your current sign-in keeps working until you switch traffic over.",
        },
      ]);
    });
  });

  describe("when the registration is refused", () => {
    it("says so beside the button, not in a toast that leaves the step stuck", () => {
      state.refusal = new Error("refused");
      const { host } = renderSection();

      fireEvent.click(screen.getByTestId("identity-provider-saml"));

      expect(screen.getByTestId("sso-inline-refusal")).toBeInTheDocument();
      expect(screen.getByText("Registering that connection didn't work")).toBeInTheDocument();
      expect(host.failures).toEqual([]);
    });
  });

  describe("given a reader who may look but not manage", () => {
    /** @scenario "A reader who may not manage single sign-on is offered no form" */
    it("offers no form, because every control here would be refused", () => {
      renderSection({ canManage: false });

      expect(screen.getByTestId("sso-register-unavailable")).toBeInTheDocument();
      expect(screen.queryByText("Who signs your team in?")).toBeNull();
    });
  });
});

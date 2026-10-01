/**
 * What the registration form becomes on the way to the command, and the one
 * piece of state a pick is allowed to move.
 */
import { describe, expect, it } from "vitest";

import { identityProviderPreset } from "../identity-providers.ts";
import {
  EMPTY_REGISTER_FORM,
  idpFromForm,
  providerNameAfterPick,
  type RegisterForm,
} from "../registration-form.ts";

function formWith(overrides: Partial<RegisterForm> = {}): RegisterForm {
  return { ...EMPTY_REGISTER_FORM, ...overrides };
}

describe("turning the form into a registration", () => {
  it("sends OpenID Connect's issuer and client credential, and nothing of the other protocol", () => {
    const idp = idpFromForm({
      protocol: "oidc",
      form: formWith({
        issuer: "https://acme.okta.com",
        clientId: "0oa1",
        clientSecret: "s3cret",
        entryPoint: "https://acme.okta.com/app/x/sso/saml",
      }),
    });

    expect(idp).toEqual({
      protocol: "oidc",
      issuer: "https://acme.okta.com",
      clientId: "0oa1",
      clientSecret: "s3cret",
    });
  });

  it("sends SAML's entry point with whatever evidence came with it", () => {
    const idp = idpFromForm({
      protocol: "saml",
      form: formWith({
        entryPoint: "https://acme.okta.com/app/x/sso/saml",
        metadataXml: "<EntityDescriptor />",
        clientSecret: "typed into the other protocol's box",
      }),
    });

    expect(idp).toEqual({
      protocol: "saml",
      entryPoint: "https://acme.okta.com/app/x/sso/saml",
      entityId: null,
      metadataXml: "<EntityDescriptor />",
      certificate: null,
    });
  });

  it("turns a box nobody filled into null, so blank is never read as supplied", () => {
    const idp = idpFromForm({
      protocol: "saml",
      form: formWith({ entryPoint: "https://sso.acme.com/saml2/sso", entityId: "" }),
    });

    expect(idp).toMatchObject({ entityId: null, metadataXml: null, certificate: null });
  });
});

describe("the name a pick prefills", () => {
  const okta = identityProviderPreset("okta");
  const entra = identityProviderPreset("entra");
  const saml = identityProviderPreset("saml");

  it("names the product, because that is what a team calls the connection", () => {
    expect(providerNameAfterPick({ preset: okta, previous: null, current: "" })).toBe("Okta");
  });

  it("replaces the previous tile's own name, so changing your mind is not a rename", () => {
    expect(providerNameAfterPick({ preset: entra, previous: okta, current: "Okta" })).toBe(
      "Microsoft Entra ID",
    );
  });

  it("leaves a name somebody typed alone", () => {
    expect(
      providerNameAfterPick({ preset: entra, previous: okta, current: "Corporate sign-in" }),
    ).toBe("Corporate sign-in");
  });

  it("fills nothing for a protocol tile, which names no product", () => {
    expect(providerNameAfterPick({ preset: saml, previous: null, current: "" })).toBe("");
  });
});

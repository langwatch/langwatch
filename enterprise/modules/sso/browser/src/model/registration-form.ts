// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the registration form holds, and the command shape it becomes (D09).
 * The two protocols carry different evidence, so they are discriminated
 * rather than one bag of optional fields — and an empty box becomes null,
 * because "not supplied" and "supplied blank" are different answers.
 */
import type { SsoSetupRegistration } from "@langwatch/enterprise-sso-contract";
import { ssoSamlIdpInitiatedSchema } from "@langwatch/identity-contract";

import type { IdentityProviderPreset, SsoProtocol } from "./identity-providers.ts";

export interface RegisterForm {
  providerId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  entryPoint: string;
  entityId: string;
  metadataXml: string;
  certificate: string;
  idpInitiated: SamlIdpInitiated;
}

export type SamlIdpInitiated = Extract<SsoSetupRegistration, { protocol: "saml" }>["idpInitiated"];

export const IDP_INITIATED_OFF: SamlIdpInitiated = { enabled: false, landingTargets: [] };

/** Whether `target` may join the list: new, and passing the contract's own check, as the server does. */
export function canListLandingTarget({
  listed,
  target,
}: {
  listed: readonly string[];
  target: string;
}): boolean {
  return (
    !listed.includes(target) &&
    ssoSamlIdpInitiatedSchema.validate({ enabled: true, landingTargets: [...listed, target] })
  );
}

export const EMPTY_REGISTER_FORM: RegisterForm = {
  providerId: "",
  issuer: "",
  clientId: "",
  clientSecret: "",
  entryPoint: "",
  entityId: "",
  metadataXml: "",
  certificate: "",
  idpInitiated: IDP_INITIATED_OFF,
};

/** The identity-provider half of the form, in the shape the command takes. */
export function idpFromForm({
  protocol,
  form,
}: {
  protocol: SsoProtocol;
  form: RegisterForm;
}): SsoSetupRegistration {
  if (protocol === "oidc") {
    return {
      protocol,
      issuer: form.issuer,
      clientId: form.clientId,
      clientSecret: form.clientSecret,
    };
  }

  return {
    protocol,
    entryPoint: form.entryPoint,
    entityId: form.entityId || null,
    metadataXml: form.metadataXml || null,
    certificate: form.certificate || null,
    idpInitiated: form.idpInitiated,
  };
}

/**
 * The name a pick prefills: a product's own name is almost always what a team
 * calls the connection, and it is the label the sign-in screen and the audit
 * log carry. Prefilled, never fixed — a name somebody typed survives every
 * later pick, and only the previous tile's own name is overwritten.
 */
export function providerNameAfterPick({
  preset,
  previous,
  current,
}: {
  preset: IdentityProviderPreset;
  previous: IdentityProviderPreset | null;
  current: string;
}): string {
  if (preset.group !== "product") return current;
  if (current === "" || current === previous?.name) return preset.name;

  return current;
}

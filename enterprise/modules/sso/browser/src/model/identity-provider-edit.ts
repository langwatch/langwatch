// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Editing an existing connection's identity provider settings: the form it is
 * prefilled with, the update it becomes, and which connections offer it.
 * Spec: specs/identity/sso-connection-edit-identity-provider.feature.
 */
import type {
  SsoSetupIdentityProviderUpdate,
  SsoSetupIdentityProviderView,
  SsoSetupPageView,
} from "@langwatch/enterprise-sso-contract";

import { EMPTY_REGISTER_FORM, type RegisterForm } from "./registration-form.ts";

type SetupConnection = NonNullable<SsoSetupPageView["connection"]>;

/**
 * Every setup state, where a wrong issuer stops the test sign-in, and the live
 * pair, where it stops everybody. A connection on its way out is not dialled
 * again, and a discarded or torn down one is history.
 */
const IDP_EDITABLE_STATES: ReadonlySet<SetupConnection["state"]> = new Set([
  "DRAFT",
  "CLAIMED",
  "APPROVED",
  "REJECTED",
  "VERIFICATION_PENDING",
  "VERIFIED",
  "ACTIVE",
  "SUSPENDED",
]);

/** A grandfathered connection dials the deployment's own provider, so it has
 *  no settings of its own to change. */
export function identityProviderIsEditable({
  canManage,
  connection,
}: {
  canManage: boolean;
  connection: Pick<SetupConnection, "source" | "state">;
}): boolean {
  return (
    canManage && connection.source === "self-serve" && IDP_EDITABLE_STATES.has(connection.state)
  );
}

/** The current settings, in the registration form's shape. The client secret
 *  is never shown back, so it starts blank. */
export function identityProviderFormFrom(current: SsoSetupIdentityProviderView): RegisterForm {
  if (current.protocol === "oidc") {
    return {
      ...EMPTY_REGISTER_FORM,
      issuer: current.issuer ?? "",
      clientId: current.clientId ?? "",
    };
  }

  return {
    ...EMPTY_REGISTER_FORM,
    entryPoint: current.entryPoint ?? "",
    entityId: current.entityId ?? "",
    metadataXml: current.metadataXml ?? "",
    certificate: current.certificate ?? "",
  };
}

/** The form in the shape the update takes. A blank client secret is sent as
 *  null, which keeps the stored one. */
export function identityProviderUpdateFromForm({
  protocol,
  form,
}: {
  protocol: SsoSetupIdentityProviderView["protocol"];
  form: RegisterForm;
}): SsoSetupIdentityProviderUpdate {
  if (protocol === "oidc") {
    return {
      protocol,
      issuer: form.issuer,
      clientId: form.clientId,
      clientSecret: form.clientSecret === "" ? null : form.clientSecret,
    };
  }

  return {
    protocol,
    entryPoint: form.entryPoint,
    entityId: form.entityId || null,
    metadataXml: form.metadataXml || null,
    certificate: form.certificate || null,
  };
}

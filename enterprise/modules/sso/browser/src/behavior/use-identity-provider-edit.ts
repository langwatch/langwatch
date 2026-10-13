// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Saving a connection's identity provider settings: the update, the reads it
 * refreshes, and the acknowledgement. The connection keeps its id, so the
 * acknowledgement says the redirect address did not move.
 */
import type { SsoSetupIdentityProviderView } from "@langwatch/enterprise-sso-contract";

import { identityProviderUpdateFromForm } from "../model/identity-provider-edit.ts";
import type { RegisterForm } from "../model/registration-form.ts";
import { useSsoHost } from "../model/sso-host.ts";
import { ssoApi } from "./sso-api.ts";

export const IDENTITY_PROVIDER_SAVED_NOTICE = {
  title: "Identity provider settings saved",
  description:
    "Your redirect address is unchanged, so nothing needs to change in your identity provider.",
} as const;

export function useIdentityProviderEdit({
  organizationId,
  connectionId,
  protocol,
  onSaved,
}: {
  organizationId: string;
  connectionId: string;
  protocol: SsoSetupIdentityProviderView["protocol"];
  onSaved: () => void;
}) {
  const host = useSsoHost();
  const utils = ssoApi.useUtils();
  const update = ssoApi.ssoSetup.updateIdentityProvider.useMutation();

  const save = (form: RegisterForm) => {
    update.mutate(
      {
        organizationId,
        connectionId,
        idp: identityProviderUpdateFromForm({ protocol, form }),
      },
      {
        onSuccess: async () => {
          const target = { organizationId, connectionId };
          await Promise.all([
            utils.ssoSetup.getSetup.invalidate(),
            utils.ssoSetup.identityProvider.invalidate(target),
            utils.ssoSetup.getHistory.invalidate(target),
          ]);
          host.succeeded(IDENTITY_PROVIDER_SAVED_NOTICE);
          onSaved();
        },
      },
    );
  };

  return { save, saving: update.isPending, refusal: update.error };
}

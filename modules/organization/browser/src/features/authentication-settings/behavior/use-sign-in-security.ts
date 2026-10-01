import type { SignInSecuritySettings } from "@langwatch/auth-contract";
import { useCallback } from "react";

import type { OrganizationHostApi } from "../../../model/organization-host.ts";
import { savedSessionMessage, SIGN_IN_SECURITY_OFF } from "../model/sign-in-security.ts";
import { signInSecurityApi } from "./sign-in-security-api.ts";

/**
 * The organization's two sign-in security rules (GAC-09, GAC-10): state and
 * callbacks, never JSX. Refusals reach the administrator as registry words.
 * specs/identity/org-account-lockout.feature, specs/identity/org-session-lifetime.feature
 */
export function useSignInSecurity({
  host,
  organizationId,
}: {
  host: OrganizationHostApi;
  organizationId: string;
}) {
  const utils = signInSecurityApi.useUtils();
  const enabled = host.hasOrganizationPermission("organization:manage");
  const settings = signInSecurityApi.signInSecurity.get.useQuery({ organizationId }, { enabled });
  const saveMutation = signInSecurityApi.signInSecurity.save.useMutation();

  const save = useCallback(
    (next: SignInSecuritySettings) => {
      saveMutation.mutate(
        { organizationId, ...next },
        {
          onSuccess: (result) => {
            host.succeeded({
              title: "Saved",
              description: savedSessionMessage(result.sweptSessions),
            });
            void utils.signInSecurity.get.invalidate();
          },
          onError: (error) => host.failed({ error, fallbackTitle: "Couldn't save that setting" }),
        },
      );
    },
    [host, organizationId, saveMutation, utils],
  );

  return {
    /** Whether the cards belong on the page at all. */
    show: enabled,
    loading: settings.isLoading,
    settings: settings.data ?? SIGN_IN_SECURITY_OFF,
    saving: saveMutation.isPending,
    save,
  };
}

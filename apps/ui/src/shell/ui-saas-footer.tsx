/**
 * Saas's footer capability, drawn once beside the toaster as main drew
 * ExtraFooterComponents. Loaded like navigation-host-capabilities.tsx.
 */

import { useUiAddress } from "@langwatch/browser-host/address";
import {
  useOptionalUiHostServices,
  useUiDeployment,
  useUiRpc,
} from "@langwatch/browser-host/capabilities";
import { queryRetryDelay, shouldRetryQuery } from "@langwatch/browser-host/query-retry";
import { useActiveScope, useSession } from "@langwatch/browser-host/session";
import { saasWeb } from "@langwatch/enterprise-saas-browser/declaration";
import { saasBrowserUserSchema } from "@langwatch/enterprise-saas-contract";
import { useMutation } from "@tanstack/react-query";
import { lazy, Suspense } from "react";

const ExtraFooterComponents = lazy(saasWeb.installation.capabilities.extraFooterComponents.load);

export function UiSaasFooter() {
  return useOptionalUiHostServices() ? <UiSaasFooterReading /> : null;
}

/** Main's useMutation: never an uncaught rejection, and upgrade_in_progress waits (UD-F3). */
export function useUpdateLastLogin(): () => void {
  const rpc = useUiRpc();
  const { mutate } = useMutation({
    mutationFn: () => rpc.mutate("user.updateLastLogin", {}),
    retry: shouldRetryQuery,
    retryDelay: queryRetryDelay,
  });
  return mutate;
}

function UiSaasFooterReading() {
  const deployment = useUiDeployment();
  const session = useSession();
  const scope = useActiveScope();
  const address = useUiAddress();
  const updateLastLogin = useUpdateLastLogin();
  const organization = scope.organization;
  // The session actor carries main's impersonator at runtime; the schema reads it typed.
  const user = saasBrowserUserSchema.safeParse(session.user).data;

  return (
    <Suspense fallback={null}>
      <ExtraFooterComponents
        isSaas={deployment.isSaaS}
        user={user}
        organization={
          organization ? { id: organization.id, name: organization.name ?? "" } : undefined
        }
        project={scope.project}
        environment={deployment.isDevelopment ? "development" : "production"}
        pathname={address.split(/[?#]/)[0] ?? "/"}
        updateLastLogin={updateLastLogin}
      />
    </Suspense>
  );
}

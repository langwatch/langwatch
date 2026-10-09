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
import { useActiveScope, useSession } from "@langwatch/browser-host/session";
import { saasWeb } from "@langwatch/enterprise-saas-browser/declaration";
import { saasBrowserUserSchema } from "@langwatch/enterprise-saas-contract";
import { lazy, Suspense, useCallback, useMemo } from "react";

const ExtraFooterComponents = lazy(saasWeb.installation.capabilities.extraFooterComponents.load);

export function UiSaasFooter() {
  return useOptionalUiHostServices() ? <UiSaasFooterReading /> : null;
}

function UiSaasFooterReading() {
  const deployment = useUiDeployment();
  const session = useSession();
  const scope = useActiveScope();
  const rpc = useUiRpc();
  const address = useUiAddress();
  const updateLastLogin = useCallback(() => {
    void rpc.mutate("user.updateLastLogin", {});
  }, [rpc]);
  const organization = scope.organization;
  // The session actor carries main's impersonator at runtime; the schema reads it typed.
  const user = useMemo(() => saasBrowserUserSchema.safeParse(session.user).data, [session.user]);

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

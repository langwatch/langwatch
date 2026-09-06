/**
 * The deployment, as a front-door screen reads it.
 *
 * Two halves, and they arrive by different roads. The STATIC half is the
 * public application config the shell already resolved — it comes off the host
 * port, because `@langwatch/ui/public-config` is where the application reads
 * it and this package may not import the application. The per-viewer half
 * (which sign-in provider this installation is configured for, whether it can
 * send mail) needs a request, so it is a query on the transport.
 *
 * Two hooks, because the answers differ in kind: `usePublicEnv` is synchronous
 * and never loading, `usePublicEnvWithCapabilities` is a query.
 */

import { authApi, type AuthViewerCapabilities } from "./auth-api.ts";
import { useAuthHost, type AuthPublicEnvironment } from "../model/auth-host.ts";

type CapabilityQuery = ReturnType<typeof authApi.publicEnv.useQuery>;

type CapabilityEnvironmentQuery = Omit<CapabilityQuery, "data"> & {
  data: (AuthPublicEnvironment & AuthViewerCapabilities) | undefined;
};

type StaticEnvironmentResult = {
  data: AuthPublicEnvironment;
  isLoading: false;
};

/** The static half alone: resolved by the shell, so never loading. */
export function usePublicEnv(): StaticEnvironmentResult {
  return { data: useAuthHost().publicEnvironment(), isLoading: false };
}

/** The static half plus the per-viewer capabilities the transport answers. */
export function usePublicEnvWithCapabilities(): CapabilityEnvironmentQuery {
  const staticValues = useAuthHost().publicEnvironment();
  const capabilities = authApi.publicEnv.useQuery(
    {},
    {
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  );

  return {
    ...capabilities,
    data: capabilities.data ? { ...staticValues, ...capabilities.data } : undefined,
  };
}

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
 * The same two overloads `platform/app`'s hook had, so no call site changed:
 * without `includeCapabilities` the answer is synchronous and never loading.
 */

import { authApi, type AuthViewerCapabilities } from "./auth-api";
import { useAuthHost, type AuthPublicEnvironment } from "../model/auth-host";

type CapabilityQuery = ReturnType<typeof authApi.publicEnv.useQuery>;

type CapabilityEnvironmentQuery = Omit<CapabilityQuery, "data"> & {
  data: (AuthPublicEnvironment & AuthViewerCapabilities) | undefined;
};

type StaticEnvironmentResult = {
  data: AuthPublicEnvironment;
  isLoading: false;
};

export function usePublicEnv(options: { includeCapabilities: true }): CapabilityEnvironmentQuery;
export function usePublicEnv(options?: { includeCapabilities?: false }): StaticEnvironmentResult;
export function usePublicEnv(
  options: { includeCapabilities?: boolean } = {},
): CapabilityEnvironmentQuery | StaticEnvironmentResult {
  const includeCapabilities = options.includeCapabilities ?? false;
  const staticValues = useAuthHost().publicEnvironment();
  const capabilities = authApi.publicEnv.useQuery(
    {},
    {
      enabled: includeCapabilities,
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  );

  if (!includeCapabilities) {
    return { data: staticValues, isLoading: false } as const;
  }

  return {
    ...capabilities,
    data: capabilities.data ? { ...staticValues, ...capabilities.data } : undefined,
  };
}

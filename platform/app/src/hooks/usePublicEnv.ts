import {
  readPublicAppConfig,
  toPublicEnvironment,
  type PublicEnvironment,
} from "@langwatch/ui/public-config";
import { api, type RouterOutputs } from "../utils/api";

type ViewerCapabilities = RouterOutputs["publicEnv"];
type CapabilityQuery = ReturnType<typeof api.publicEnv.useQuery>;
type CapabilityEnvironmentQuery = Omit<CapabilityQuery, "data"> & {
  data: (PublicEnvironment & ViewerCapabilities) | undefined;
};

type StaticEnvironmentResult = {
  data: PublicEnvironment;
  isLoading: false;
};

export function usePublicEnv(options: { includeCapabilities: true }): CapabilityEnvironmentQuery;
export function usePublicEnv(options?: { includeCapabilities?: false }): StaticEnvironmentResult;
export function usePublicEnv(
  options: {
    includeCapabilities?: boolean;
  } = {},
): CapabilityEnvironmentQuery | StaticEnvironmentResult {
  const includeCapabilities = options.includeCapabilities ?? false;
  const capabilities = api.publicEnv.useQuery(
    {},
    {
      enabled: includeCapabilities,
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  );

  const staticValues = toPublicEnvironment(readPublicAppConfig());

  if (!includeCapabilities) {
    return { data: staticValues, isLoading: false } as const;
  }

  return {
    ...capabilities,
    data: capabilities.data ? { ...staticValues, ...capabilities.data } : undefined,
  };
}

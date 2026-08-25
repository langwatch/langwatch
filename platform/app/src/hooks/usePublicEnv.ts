import { api, type RouterOutputs } from "../utils/api";
import { readPublicAppConfig } from "../runtime/public-config";

export type PublicEnvironment = {
  BASE_HOST: string;
  DEMO_PROJECT_SLUG: string | undefined;
  NODE_ENV: "development" | "test" | "production";
  HAS_EMAIL_PROVIDER_KEY: boolean;
  IS_SAAS: boolean;
  GATEWAY_BASE_URL: string;
  POSTHOG_KEY: string | undefined;
  POSTHOG_HOST: string | undefined;
  RUM_ENABLED: boolean;
  RUM_SAMPLE_RATIO: number;
  HAS_LANGWATCH_NLP_SERVICE: boolean;
  HAS_LANGEVALS_ENDPOINT: boolean;
  STRIPE_LICENSE_PAYMENT_LINK_URL: string | undefined;
};

type ViewerCapabilities = RouterOutputs["publicEnv"];
type CapabilityQuery = ReturnType<typeof api.publicEnv.useQuery>;
type CapabilityEnvironmentQuery = Omit<CapabilityQuery, "data"> & {
  data: (PublicEnvironment & ViewerCapabilities) | undefined;
};

type StaticEnvironmentResult = {
  data: PublicEnvironment;
  isLoading: false;
};

export function usePublicEnv(options: {
  includeCapabilities: true;
}): CapabilityEnvironmentQuery;
export function usePublicEnv(options?: {
  includeCapabilities?: false;
}): StaticEnvironmentResult;
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

  const config = readPublicAppConfig();
  const staticValues: PublicEnvironment = {
    BASE_HOST: config.appBaseUrl,
    DEMO_PROJECT_SLUG: config.demoProjectSlug,
    NODE_ENV: config.mode,
    HAS_EMAIL_PROVIDER_KEY: config.capabilities.email,
    IS_SAAS: config.deployment === "saas",
    GATEWAY_BASE_URL: config.gatewayBaseUrl,
    POSTHOG_KEY: config.telemetry.posthog?.key,
    POSTHOG_HOST: config.telemetry.posthog?.host,
    RUM_ENABLED: config.telemetry.browserTracing,
    RUM_SAMPLE_RATIO: config.telemetry.sampleRatio,
    HAS_LANGWATCH_NLP_SERVICE: config.capabilities.nlp,
    HAS_LANGEVALS_ENDPOINT: config.capabilities.langevals,
    STRIPE_LICENSE_PAYMENT_LINK_URL: config.licensePaymentUrl,
  };

  if (!includeCapabilities) {
    return { data: staticValues, isLoading: false } as const;
  }

  return {
    ...capabilities,
    data: capabilities.data ? { ...staticValues, ...capabilities.data } : undefined,
  };
}

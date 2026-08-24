import { api } from "../utils/api";
import { readPublicAppConfig } from "../runtime/public-config";

export type UsePublicEnvOptions = {
  /** Fetch identity/license-dependent values in addition to shell config. */
  includeCapabilities?: boolean;
};

export const usePublicEnv = (options: UsePublicEnvOptions = {}) => {
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
  const staticValues = {
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
  } as const;

  if (!includeCapabilities) {
    return { data: staticValues, isLoading: false } as const;
  }

  return {
    ...capabilities,
    data: capabilities.data
      ? { ...staticValues, ...capabilities.data }
      : undefined,
  };
};

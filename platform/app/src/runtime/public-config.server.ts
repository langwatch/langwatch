import { RUM_DEFAULT_SAMPLE_RATIO } from "@langwatch/react-rum/constants";
import type { PublicAppConfig } from "@langwatch/ui/public-config";
import { publicAppConfigSchema } from "@langwatch/ui/public-config";

export type PublicAppConfigSource = Readonly<{
  BASE_HOST?: string;
  DEMO_PROJECT_SLUG?: string;
  NODE_ENV: "development" | "test" | "production";
  EMAIL_PROVIDER?: string;
  USE_AWS_SES?: string;
  AWS_REGION?: string;
  SENDGRID_API_KEY?: string;
  SMTP_URL?: string;
  SMTP_HOST?: string;
  RESEND_API_KEY?: string;
  IS_SAAS?: boolean;
  LW_GATEWAY_PUBLIC_URL?: string;
  LW_GATEWAY_BASE_URL?: string;
  POSTHOG_KEY?: string;
  POSTHOG_HOST?: string;
  RUM_ENABLED?: boolean;
  RUM_SAMPLE_RATIO?: number;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  LANGWATCH_NLP_SERVICE?: string;
  LANGWATCH_NLP_LAMBDA_CONFIG?: string;
  LANGEVALS_ENDPOINT?: string;
  STRIPE_LICENSE_PAYMENT_LINK_URL?: string;
}>;

export const SAAS_GATEWAY_URL = "https://gateway.langwatch.ai" as const;
export const LOCAL_GATEWAY_URL = "http://localhost:5563" as const;

/**
 * Resolves the process-level gateway host. This is deployment configuration,
 * not Governance domain policy: the browser shell and the API composition use
 * the same value before either transport reaches the feature.
 */
export function resolveGatewayBaseUrl(
  source: Pick<
    PublicAppConfigSource,
    "LW_GATEWAY_PUBLIC_URL" | "LW_GATEWAY_BASE_URL" | "IS_SAAS"
  >,
): string {
  return (
    source.LW_GATEWAY_PUBLIC_URL ??
    source.LW_GATEWAY_BASE_URL ??
    (source.IS_SAAS ? SAAS_GATEWAY_URL : LOCAL_GATEWAY_URL)
  );
}

const hasConfiguredEmailDelivery = (source: PublicAppConfigSource): boolean => {
  const configured = source.EMAIL_PROVIDER?.trim().toLowerCase();
  const available = {
    ses: Boolean(source.USE_AWS_SES && source.AWS_REGION),
    sendgrid: Boolean(source.SENDGRID_API_KEY),
    smtp: Boolean(source.SMTP_URL ?? source.SMTP_HOST),
    resend: Boolean(source.RESEND_API_KEY),
  } as const;

  if (configured) {
    return configured in available
      ? available[configured as keyof typeof available]
      : false;
  }

  // Preserve the mailer's legacy inference order. SMTP and Resend require an
  // explicit EMAIL_PROVIDER; SES and SendGrid historically did not.
  return available.ses || available.sendgrid;
};

/** Maps validated private process config to the exact browser-safe contract. */
export class PublicAppConfigService {
  resolve(source: PublicAppConfigSource): PublicAppConfig {
    return publicAppConfigSchema.parse({
      appBaseUrl: source.BASE_HOST,
      gatewayBaseUrl: resolveGatewayBaseUrl(source),
      deployment: source.IS_SAAS ? "saas" : "self-hosted",
      demoProjectSlug: source.DEMO_PROJECT_SLUG,
      mode: source.NODE_ENV,
      telemetry: {
        browserTracing: Boolean(source.RUM_ENABLED && source.OTEL_EXPORTER_OTLP_ENDPOINT),
        sampleRatio: source.RUM_SAMPLE_RATIO ?? RUM_DEFAULT_SAMPLE_RATIO,
        posthog: source.POSTHOG_KEY
          ? { key: source.POSTHOG_KEY, host: source.POSTHOG_HOST }
          : void 0,
      },
      capabilities: {
        email: hasConfiguredEmailDelivery(source),
        nlp: Boolean(source.LANGWATCH_NLP_SERVICE || source.LANGWATCH_NLP_LAMBDA_CONFIG),
        langevals: Boolean(source.LANGEVALS_ENDPOINT),
      },
      licensePaymentUrl: source.STRIPE_LICENSE_PAYMENT_LINK_URL,
    });
  }
}

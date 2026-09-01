import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";
import { publicAppConfigSchema, type PublicAppConfig } from "../model/public-config";

export const SAAS_GATEWAY_URL = "https://gateway.langwatch.ai" as const;
export const LOCAL_GATEWAY_URL = "http://localhost:5563" as const;
const DEFAULT_RUM_SAMPLE_RATIO = 1;

const exactTrue = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => value === true || value === "true");

const sampleRatio = z
  .preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().min(0).max(1).default(DEFAULT_RUM_SAMPLE_RATIO).catch(DEFAULT_RUM_SAMPLE_RATIO),
  );

/**
 * Private deployment inputs used solely to derive the browser allow-list.
 * This declaration is intentionally separate from the browser schema: its
 * values never cross the HTML boundary directly.
 */
export const publicAppConfigProjectionDefinition = RuntimeConfig.define({
  appBaseUrl: Config.value(z.string().min(1), { env: "BASE_HOST" }),
  nodeEnvironment: Config.value(z.enum(["development", "test", "production"]), {
    env: "NODE_ENV",
  }),
  demoProjectSlug: Config.value(z.string().min(1).optional(), { env: "DEMO_PROJECT_SLUG" }),
  isSaas: Config.value(exactTrue, { env: "IS_SAAS" }),
  gateway: {
    publicUrl: Config.url({ optional: true, env: "LW_GATEWAY_PUBLIC_URL" }),
    legacyUrl: Config.url({ optional: true, env: "LW_GATEWAY_BASE_URL" }),
  },
  telemetry: {
    rumEnabled: Config.value(exactTrue, { env: "RUM_ENABLED" }),
    sampleRatio: Config.value(sampleRatio, { env: "RUM_SAMPLE_RATIO" }),
    otlpEndpoint: Config.value(z.string().optional(), { env: "OTEL_EXPORTER_OTLP_ENDPOINT" }),
    posthogKey: Config.value(z.string().min(1).optional(), { env: "POSTHOG_KEY" }),
    posthogHost: Config.value(z.string().min(1).optional(), { env: "POSTHOG_HOST" }),
  },
  capabilities: {
    emailProvider: Config.value(z.string().optional(), { env: "EMAIL_PROVIDER" }),
    useAwsSes: Config.value(z.union([z.string(), z.boolean()]).optional(), {
      env: "USE_AWS_SES",
    }),
    awsRegion: Config.value(z.string().optional(), { env: "AWS_REGION" }),
    sendgridApiKey: Config.secret({ optional: true, env: "SENDGRID_API_KEY" }),
    smtpUrl: Config.value(z.string().optional(), { env: "SMTP_URL" }),
    smtpHost: Config.value(z.string().optional(), { env: "SMTP_HOST" }),
    resendApiKey: Config.secret({ optional: true, env: "RESEND_API_KEY" }),
    nlpService: Config.value(z.string().optional(), { env: "LANGWATCH_NLP_SERVICE" }),
    nlpLambdaConfig: Config.value(z.string().optional(), { env: "LANGWATCH_NLP_LAMBDA_CONFIG" }),
    langevalsEndpoint: Config.value(z.string().optional(), { env: "LANGEVALS_ENDPOINT" }),
  },
  identity: {
    passkeys: Config.value(z.enum(["off", "on"]).optional().default("off"), {
      env: "PASSKEYS_ENABLED",
    }),
    router: Config.value(z.enum(["off", "shadow", "enforce"]).optional().default("off"), {
      env: "IDENTITY_ROUTER_V2",
    }),
  },
  licensePaymentUrl: Config.value(z.string().min(1).optional(), {
    env: "STRIPE_LICENSE_PAYMENT_LINK_URL",
  }),
});

type PublicAppConfigValues = ConfigValue<typeof publicAppConfigProjectionDefinition>;

/**
 * The physical UI process has exactly one role. Keeping this gate beside the
 * public projection prevents a worker/API deployment from accidentally using
 * the browser bootstrap configuration.
 */
const uiPublicBootstrapDefinition = RuntimeConfig.define({
  processRole: Config.value(z.literal("ui").default("ui"), { env: "UI_PROCESS_ROLE" }),
  public: publicAppConfigProjectionDefinition,
});

type UiPublicBootstrapValues = ConfigValue<typeof uiPublicBootstrapDefinition>;

export type UiPublicBootstrap = Readonly<{
  processRole: UiPublicBootstrapValues["processRole"];
  publicConfig: PublicAppConfig;
}>;

/**
 * The source belongs to a server-side composition root. It accepts values that
 * a prior boot boundary may already have normalized as well as raw strings.
 */
export type PublicAppConfigSource = Readonly<{
  BASE_HOST?: string;
  DEMO_PROJECT_SLUG?: string;
  NODE_ENV?: string;
  UI_PROCESS_ROLE?: string;
  EMAIL_PROVIDER?: string;
  USE_AWS_SES?: string | boolean;
  AWS_REGION?: string;
  SENDGRID_API_KEY?: string;
  SMTP_URL?: string;
  SMTP_HOST?: string;
  RESEND_API_KEY?: string;
  IS_SAAS?: string | boolean;
  LW_GATEWAY_PUBLIC_URL?: string;
  LW_GATEWAY_BASE_URL?: string;
  POSTHOG_KEY?: string;
  POSTHOG_HOST?: string;
  RUM_ENABLED?: string | boolean;
  RUM_SAMPLE_RATIO?: string | number;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  LANGWATCH_NLP_SERVICE?: string;
  LANGWATCH_NLP_LAMBDA_CONFIG?: string;
  LANGEVALS_ENDPOINT?: string;
  PASSKEYS_ENABLED?: string;
  IDENTITY_ROUTER_V2?: string;
  STRIPE_LICENSE_PAYMENT_LINK_URL?: string;
}> &
  Readonly<Record<string, unknown>>;

export type GatewayBaseUrlSource =
  | Pick<PublicAppConfigValues, "gateway" | "isSaas">
  | Readonly<{
      LW_GATEWAY_PUBLIC_URL?: string;
      LW_GATEWAY_BASE_URL?: string;
      IS_SAAS?: boolean;
    }>;

export function resolveGatewayBaseUrl(source: GatewayBaseUrlSource): string {
  const gateway =
    "gateway" in source
      ? source.gateway
      : {
          publicUrl: source.LW_GATEWAY_PUBLIC_URL,
          legacyUrl: source.LW_GATEWAY_BASE_URL,
        };
  const isSaas = "isSaas" in source ? source.isSaas : source.IS_SAAS;

  return (
    gateway.publicUrl ?? gateway.legacyUrl ?? (isSaas ? SAAS_GATEWAY_URL : LOCAL_GATEWAY_URL)
  );
}

/** Resolves private process inputs to the exact browser-safe bootstrap contract. */
export function resolvePublicAppConfig(
  source: PublicAppConfigSource,
): PublicAppConfig {
  const config = RuntimeConfig.create({
    name: "ui public bootstrap",
    definition: publicAppConfigProjectionDefinition,
    source: { ...source },
  }).value;

  return projectPublicAppConfig(config);
}

/**
 * Parses the complete UI bootstrap exactly once at the physical process
 * boundary. Callers receive only the UI role and browser-safe projection.
 */
export function resolveUiPublicBootstrap(source: PublicAppConfigSource): UiPublicBootstrap {
  const config = RuntimeConfig.create({
    name: "ui public bootstrap",
    definition: uiPublicBootstrapDefinition,
    source: { ...source },
  }).value;

  return {
    processRole: config.processRole,
    publicConfig: projectPublicAppConfig(config.public),
  };
}

function projectPublicAppConfig(config: PublicAppConfigValues): PublicAppConfig {
  return publicAppConfigSchema.parse({
    appBaseUrl: config.appBaseUrl,
    gatewayBaseUrl: resolveGatewayBaseUrl(config),
    deployment: config.isSaas ? "saas" : "self-hosted",
    demoProjectSlug: config.demoProjectSlug,
    mode: config.nodeEnvironment,
    telemetry: {
      browserTracing: config.telemetry.rumEnabled && Boolean(config.telemetry.otlpEndpoint),
      sampleRatio: config.telemetry.sampleRatio,
      posthog: config.telemetry.posthogKey
        ? { key: config.telemetry.posthogKey, host: config.telemetry.posthogHost }
        : void 0,
    },
    capabilities: {
      email: hasConfiguredEmailDelivery(config),
      nlp: Boolean(config.capabilities.nlpService || config.capabilities.nlpLambdaConfig),
      langevals: Boolean(config.capabilities.langevalsEndpoint),
    },
    // `deploymentOffersPasskeys()` and `signInRouterMode()` are the server
    // halves of these two reads; keeping the derivation identical is what
    // stops the button and the endpoint behind it from disagreeing.
    passkeys: config.identity.passkeys === "on",
    identityFrontDoor: config.identity.router === "enforce",
    licensePaymentUrl: config.licensePaymentUrl,
  });
}

function hasConfiguredEmailDelivery(config: PublicAppConfigValues): boolean {
  const configured = config.capabilities.emailProvider?.trim().toLowerCase();
  const available = {
    ses: Boolean(config.capabilities.useAwsSes && config.capabilities.awsRegion),
    sendgrid: Boolean(config.capabilities.sendgridApiKey),
    smtp: Boolean(config.capabilities.smtpUrl ?? config.capabilities.smtpHost),
    resend: Boolean(config.capabilities.resendApiKey),
  } as const;

  if (configured) {
    return configured in available ? available[configured as keyof typeof available] : false;
  }

  return available.ses || available.sendgrid;
}

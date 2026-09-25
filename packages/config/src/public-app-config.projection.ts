import { z } from "zod";

import { Config, parseProcessConfig, type ConfigOf, type ConfigSlice } from "./config.ts";
import { gatewayAddressOf } from "./deployment-facts.ts";
import {
  processWebConfigSchema,
  publicAppConfigSchema,
  type PublicAppConfig,
} from "./public-app-config.ts";

/**
 * Deployment's private inputs, projected to the browser-safe contract. A separate module
 * because it names secret variables at module scope; if joined with the contract, those names
 * and the config runtime would reach the browser despite `sideEffects: false`.
 */

export { LOCAL_GATEWAY_URL, SAAS_GATEWAY_URL } from "./deployment-facts.ts";
const DEFAULT_RUM_SAMPLE_RATIO = 1;

const exactTrue = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => value === true || value === "true");

const onOff = z
  .enum(["0", "1", "false", "true"])
  .optional()
  .transform((value) => value === "1" || value === "true");

const sampleRatio = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().min(0).max(1).default(DEFAULT_RUM_SAMPLE_RATIO).catch(DEFAULT_RUM_SAMPLE_RATIO),
);

/**
 * Private deployment inputs used solely to derive the browser allow-list.
 * This declaration is intentionally separate from the browser schema: its
 * values never cross the HTML boundary directly.
 */
const optionalUrl = z.string().url().optional();

export const publicAppConfigProjectionDefinition = Config.define((c) => ({
  appBaseUrl: c.env("BASE_HOST", z.string().min(1)),
  nodeEnvironment: c.env("NODE_ENV", z.enum(["development", "test", "production"])),
  demoProjectSlug: c.env("DEMO_PROJECT_SLUG", z.string().min(1).optional()),
  isSaas: c.env("IS_SAAS", exactTrue),
  authProvider: c.env("NEXTAUTH_PROVIDER", z.string().min(1).optional()),
  authProviderName: c.env("AUTH_PROVIDER", z.string().min(1).optional()),
  gateway: {
    publicUrl: c.env("LW_GATEWAY_PUBLIC_URL", optionalUrl),
    legacyUrl: c.env("LW_GATEWAY_BASE_URL", optionalUrl),
  },
  telemetry: {
    rumEnabled: c.env("RUM_ENABLED", exactTrue),
    sampleRatio: c.env("RUM_SAMPLE_RATIO", sampleRatio),
    otlpEndpoint: c.env("OTEL_EXPORTER_OTLP_ENDPOINT", z.string().optional()),
    posthogKey: c.env("POSTHOG_KEY", z.string().min(1).optional()),
    posthogHost: c.env("POSTHOG_HOST", z.string().min(1).optional()),
  },
  capabilities: {
    emailProvider: c.env("EMAIL_PROVIDER", z.string().optional()),
    useAwsSes: c.env("USE_AWS_SES", z.union([z.string(), z.boolean()]).optional()),
    awsRegion: c.env("AWS_REGION", z.string().optional()),
    smtpHost: c.env("SMTP_HOST", z.string().optional()),
    nlpService: c.env("LANGWATCH_NLP_SERVICE", z.string().optional()),
    langevalsEndpoint: c.env("LANGEVALS_ENDPOINT", z.string().optional()),
  },
  identity: {
    passkeys: c.env("PASSKEYS_ENABLED", z.enum(["off", "on"]).optional().default("off")),
    router: c.env(
      "IDENTITY_ROUTER_V2",
      z.enum(["off", "shadow", "enforce"]).optional().default("off"),
    ),
  },
  licensePaymentUrl: c.env("STRIPE_LICENSE_PAYMENT_LINK_URL", z.string().min(1).optional()),
  hideDevIndicator: c.env("HIDE_DEV_INDICATOR", onOff),
}));

type PublicAppConfigValues = ConfigOf<typeof publicAppConfigProjectionDefinition>;

/**
 * The physical UI process has exactly one role. Keeping this gate beside the
 * public projection prevents a worker/API deployment from accidentally using
 * the browser bootstrap configuration.
 */
const uiPublicBootstrapDefinition = Config.define((c) => ({
  processRole: c.env("UI_PROCESS_ROLE", z.literal("ui").default("ui")),
  public: publicAppConfigProjectionDefinition,
}));

type UiPublicBootstrapValues = ConfigOf<typeof uiPublicBootstrapDefinition>;

export type UiPublicBootstrap = Readonly<{
  processRole: UiPublicBootstrapValues["processRole"];
  publicConfig: PublicAppConfig;
}>;

/**
 * Whether each credential-carrying input resolved — never the value. The
 * handles themselves are declared at the owner that resolves them (ADR-132);
 * this file is on the browser build path and must not name the secrets runtime.
 */
export type CredentialPresence = Readonly<{
  sendgrid?: boolean;
  resend?: boolean;
  smtpUrl?: boolean;
  nlpLambdaConfig?: boolean;
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
  NEXTAUTH_PROVIDER?: string;
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

  return gatewayAddressOf({
    publicUrl: gateway.publicUrl,
    legacyUrl: gateway.legacyUrl,
    isSaas: Boolean(isSaas),
  });
}

/**
 * A source may carry values a prior boundary already normalised; the one parse
 * reads the environment as written, so they are spelled back to strings here.
 */
const asEnvironment = (source: PublicAppConfigSource): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(source).map(([key, value]) => [key, spelled(value)]));

/** Only a scalar has an environment spelling; anything else never had one. */
function spelled(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return void 0;
}

const parseOwned = <const Slice extends ConfigSlice>(
  slice: Slice,
  source: PublicAppConfigSource,
): ConfigOf<Slice> =>
  parseProcessConfig({
    owners: [{ name: "ui", config: slice }],
    environment: asEnvironment(source),
  }).ui as ConfigOf<Slice>;

/** Resolves private process inputs to the exact browser-safe bootstrap contract. */
export function resolvePublicAppConfig(
  source: PublicAppConfigSource,
  credentials: CredentialPresence = {},
): PublicAppConfig {
  return projectPublicAppConfig(
    parseOwned(publicAppConfigProjectionDefinition, source),
    credentials,
  );
}

/**
 * Parses the complete UI bootstrap exactly once at the physical process
 * boundary. Callers receive only the UI role and browser-safe projection.
 */
export function resolveUiPublicBootstrap(
  source: PublicAppConfigSource,
  credentials: CredentialPresence = {},
): UiPublicBootstrap {
  const config = parseOwned(uiPublicBootstrapDefinition, source);

  return {
    processRole: config.processRole,
    publicConfig: projectPublicAppConfig(config.public, credentials),
  };
}

/**
 * The dev server's copy of each owner's projection, namespaced as the api
 * serves it. It cannot import the contracts that declare them (they import
 * this package), so a slice changed there changes here too.
 */
function projectPublicAppConfig(
  config: PublicAppConfigValues,
  credentials: CredentialPresence,
): PublicAppConfig {
  return publicAppConfigSchema.parse({
    process: processWebConfigSchema.parse({
      appBaseUrl: config.appBaseUrl,
      mode: config.nodeEnvironment,
      deployment: config.isSaas ? "saas" : "self-hosted",
      nlp: Boolean(config.capabilities.nlpService || credentials.nlpLambdaConfig),
      browserTracing: config.telemetry.rumEnabled && Boolean(config.telemetry.otlpEndpoint),
      sampleRatio: config.telemetry.sampleRatio,
      ...(config.hideDevIndicator ? { hideDevIndicator: true } : {}),
    }),
    auth: {
      passkeys: config.identity.passkeys === "on",
      identityFrontDoor: config.identity.router === "enforce",
      authProvider: config.authProviderName ?? config.authProvider,
    },
    authz: { demoProjectSlug: config.demoProjectSlug },
    billing: { licensePaymentUrl: config.licensePaymentUrl },
    evaluation: { langevals: Boolean(config.capabilities.langevalsEndpoint) },
    gateway: { gatewayBaseUrl: resolveGatewayBaseUrl(config) },
    notification: { email: hasConfiguredEmailDelivery(config, credentials) },
    ops: config.telemetry.posthogKey
      ? { posthog: { key: config.telemetry.posthogKey, host: config.telemetry.posthogHost } }
      : {},
  });
}

function hasConfiguredEmailDelivery(
  config: PublicAppConfigValues,
  credentials: CredentialPresence,
): boolean {
  const configured = config.capabilities.emailProvider?.trim().toLowerCase();
  const available = {
    ses: Boolean(config.capabilities.useAwsSes && config.capabilities.awsRegion),
    sendgrid: Boolean(credentials.sendgrid),
    smtp: Boolean(credentials.smtpUrl ?? config.capabilities.smtpHost),
    resend: Boolean(credentials.resend),
  } as const;

  if (configured) {
    return configured in available ? available[configured as keyof typeof available] : false;
  }

  return available.ses || available.sendgrid;
}

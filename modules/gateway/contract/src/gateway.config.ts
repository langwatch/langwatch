import {
  Config,
  gatewayAddressOf,
  gatewayInternalUrl,
  gatewayLegacyUrl,
  gatewayPublicUrl,
  isSaas,
  type ConfigOf,
} from "@langwatch/config";
import { defineBrowserConfig } from "@langwatch/config/public-app-config";
import { z } from "zod";

import type { GatewayCacheRuleResource } from "./gateway-cache-rule.ts";
import type { GatewayGuardrailBundleEntry } from "./gateway-guardrail.ts";

/**
 * `internalSecret`, `jwtSecret` and `virtualKeyPepper` resolve through
 * `GatewayApp.secrets` (ADR-132), never this slice.
 * spendSettlementGraceMs carried as-is.
 */
export const gatewayConfig = Config.define((c) => ({
  /** How long after a request an outcome may still arrive. */
  spendSettlementGraceMs: c.env("LW_SPEND_SETTLEMENT_GRACE_MS", z.string().optional()),
  /** Where this control plane reaches the gateway's own surface. */
  internalUrl: gatewayInternalUrl,
  /** Where the gateway is told to reach this control plane; the public base URL otherwise. */
  controlPlaneUrl: c.env("GATEWAY_CONTROL_PLANE_URL", z.string().optional()),
  /** Where apps reach the gateway, when no internal address is set. Legacy name, still honoured. */
  baseUrl: gatewayLegacyUrl,
  /** Where apps outside the deployment reach the gateway. */
  publicUrl: gatewayPublicUrl,
  /** The process's own leaf, read here only to pick the browser's default address. */
  isSaas,
}));

export type GatewayServerConfig = ConfigOf<typeof gatewayConfig>;

/** The three variables that provision the AI Gateway, in the order to report. */
export const GATEWAY_SECRET_ENVS = [
  "LW_GATEWAY_INTERNAL_SECRET",
  "LW_GATEWAY_JWT_SECRET",
  "LW_VIRTUAL_KEY_PEPPER",
] as const;

export type GatewaySecretEnv = (typeof GATEWAY_SECRET_ENVS)[number];

/**
 * The shortest value accepted, in characters — 32 bytes of hex is 64, and the
 * floor sits at the number of characters `openssl rand -hex 16` produces so a
 * shorter one is unambiguously a placeholder rather than a weaker key.
 */
export const GATEWAY_SECRET_MIN_LENGTH = 32;

/** The command the refusals tell an operator to run. */
export const GATEWAY_SECRET_GENERATE_COMMAND = "openssl rand -hex 32";

/** The refusal, carrying the variables it names as fields as well as prose. */
export class GatewaySecretsConfigurationError extends Error {
  override readonly name = "GatewaySecretsConfigurationError";
  /** Every variable the operator has to change. */
  readonly envs: readonly GatewaySecretEnv[];

  constructor(message: string, envs: readonly GatewaySecretEnv[]) {
    super(message);
    this.envs = envs;
  }
}

/**
 * Refuses a partial or too-short set of gateway secrets, silent otherwise.
 * Length is checked first: a placeholder secret has a length problem, and
 * naming the two not yet reached would name the wrong fix.
 */
export function assertGatewaySecretsAllOrNone(source: Readonly<Record<string, unknown>>): void {
  // A blank export is not a value: an operator who exported `""` set nothing.
  const stated = (env: GatewaySecretEnv): string => {
    const raw = source[env];
    return typeof raw === "string" ? raw.trim() : "";
  };
  const present = GATEWAY_SECRET_ENVS.filter((env) => stated(env) !== "");
  if (present.length === 0) return;

  const short = present.filter((env) => stated(env).length < GATEWAY_SECRET_MIN_LENGTH);
  if (short.length > 0) {
    throw new GatewaySecretsConfigurationError(
      `${short.join(", ")} ${short.length === 1 ? "is" : "are"} shorter than the minimum of ` +
        `${GATEWAY_SECRET_MIN_LENGTH} characters. Generate each value with: ` +
        `${GATEWAY_SECRET_GENERATE_COMMAND}`,
      short,
    );
  }

  const missing = GATEWAY_SECRET_ENVS.filter((env) => stated(env) === "");
  if (missing.length === 0) return;

  throw new GatewaySecretsConfigurationError(
    `The AI Gateway secrets are partly configured: ${missing.join(", ")} ` +
      `${missing.length === 1 ? "is" : "are"} unset. Set all three of ` +
      `${GATEWAY_SECRET_ENVS.join(", ")} together, or none of them — a deployment that runs no ` +
      `gateway needs none. Generate each value with: ${GATEWAY_SECRET_GENERATE_COMMAND}`,
    missing,
  );
}

/** Where this deployment reaches the gateway, and where the gateway should reach back. */
export type GatewayDeploymentAddresses = Readonly<{
  baseUrl: string | undefined;
  /** What an app outside the deployment is told to point at. */
  publicUrl: string | undefined;
  expectedControlPlaneUrl: string | undefined;
}>;

/** The browser only learns where the gateway answers, never a secret. */
export const gatewayWebConfigSchema = z.strictObject({
  gatewayBaseUrl: z.string().min(1),
});

export type GatewayWebConfig = z.infer<typeof gatewayWebConfigSchema>;

export const gatewayBrowserConfig = defineBrowserConfig({
  schema: gatewayWebConfigSchema,
  project: (config: GatewayServerConfig) => ({
    gatewayBaseUrl: gatewayAddressOf({
      publicUrl: config.publicUrl,
      legacyUrl: config.baseUrl,
      isSaas: config.isSaas,
    }),
  }),
});

/** One direction's guardrail references, as a key's configuration names them. */
export type GatewayConfigGuardrailAttachment = {
  direction: "pre" | "post" | "stream_chunk";
  guardrailIds: string[];
};

/** The persisted half of a configuration bundle, before the wire shape is built. */
export type GatewayConfigBundlePersistence = {
  cacheRules: GatewayCacheRuleResource[];
  guardrails: GatewayGuardrailBundleEntry[];
  attachments: GatewayConfigGuardrailAttachment[];
};

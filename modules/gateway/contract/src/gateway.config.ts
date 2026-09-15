import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

import type { GatewayCacheRuleResource } from "./gateway-cache-rule.ts";
import type { GatewayGuardrailBundleEntry } from "./gateway-guardrail.ts";

/**
 * Secrets for virtual-key traffic and spend settlement, all-or-none at boot.
 * spendSettlementGraceMs carried as-is.
 */
export const gatewayServerConfigDefinition = RuntimeConfig.define({
  /** Verified before any handler runs; blank answers 500, never falls open. */
  internalSecret: Config.value(z.string().optional(), { env: "LW_GATEWAY_INTERNAL_SECRET" }),
  /** Signs short-lived JWTs handed OUT to the data plane; rotates separately. */
  jwtSecret: Config.value(z.string().optional(), { env: "LW_GATEWAY_JWT_SECRET" }),
  /** Separate from the API-key pepper: virtual keys rotate independently. */
  virtualKeyPepper: Config.value(z.string().optional(), { env: "LW_VIRTUAL_KEY_PEPPER" }),
  /** How long after a request an outcome may still arrive. */
  spendSettlementGraceMs: Config.value(z.string().optional(), {
    env: "LW_SPEND_SETTLEMENT_GRACE_MS",
  }),
});

export type GatewayServerConfig = ConfigValue<typeof gatewayServerConfigDefinition>;

export const gatewayServerConfigSchema = compileRuntimeConfig(gatewayServerConfigDefinition);

/**
 * Boot refusal for incomplete gateway config (all three secrets or none);
 * separate refusal for values too short.
 */

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
  const present = GATEWAY_SECRET_ENVS.filter((env) => stated(source[env]) !== undefined);
  if (present.length === 0) return;

  const short = present.filter(
    (env) => (stated(source[env]) ?? "").length < GATEWAY_SECRET_MIN_LENGTH,
  );
  if (short.length > 0) {
    throw new GatewaySecretsConfigurationError(
      `${short.join(", ")} ${short.length === 1 ? "is" : "are"} shorter than the minimum of ` +
        `${GATEWAY_SECRET_MIN_LENGTH} characters. Generate each value with: ` +
        `${GATEWAY_SECRET_GENERATE_COMMAND}`,
      short,
    );
  }

  const missing = GATEWAY_SECRET_ENVS.filter((env) => stated(source[env]) === undefined);
  if (missing.length === 0) return;

  throw new GatewaySecretsConfigurationError(
    `The AI Gateway secrets are partly configured: ${missing.join(", ")} ` +
      `${missing.length === 1 ? "is" : "are"} unset. Set all three of ` +
      `${GATEWAY_SECRET_ENVS.join(", ")} together, or none of them — a deployment that runs no ` +
      `gateway needs none. Generate each value with: ${GATEWAY_SECRET_GENERATE_COMMAND}`,
    missing,
  );
}

/** A blank export is not a value: an operator who exported `""` set nothing. */
function stated(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value === "" ? undefined : value;
}

/** The browser only learns where the gateway answers, never a secret. */
export const gatewayWebConfigSchema = z.strictObject({
  gatewayBaseUrl: z.string().min(1),
});

export type GatewayWebConfig = z.infer<typeof gatewayWebConfigSchema>;

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

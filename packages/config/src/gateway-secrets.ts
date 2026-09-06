/**
 * The boot refusal that keeps a deployment out of a half-configured AI Gateway.
 *
 * The three secrets are individually optional on purpose: a deployment that
 * runs no gateway sets none of them and boots clean.
 *
 * What is never a deployment shape is SOME of them. The process starts, serves,
 * and then fails minutes later on the first virtual-key request with a 503 from
 * `/api/internal/gateway/*`, which reads as an outage rather than as the
 * configuration mistake it is. So the rule is all three or none, at boot.
 *
 * A value shorter than the floor is refused separately, because "set, but too
 * short" and "not set" need different words. Neither refusal prints a value.
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
 * Refuses a partial or too-short set of gateway secrets, and says nothing
 * otherwise.
 *
 * Length is checked first: a deployment that set one secret to a placeholder
 * has a length problem, and naming the two it has not reached yet would name
 * the wrong fix.
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

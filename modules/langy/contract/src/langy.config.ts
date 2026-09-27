import {
  Config,
  type ConfigOf,
  gatewayInternalUrl,
  gatewayLegacyUrl,
  gatewayPublicUrl,
} from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";
import { z } from "zod";

/**
 * Where the agent manager answers, and the addresses its worker calls back on.
 * `internalSecret` resolves through `LangyApp.secrets` (ADR-132), never this
 * slice — see `assertLangyServerConfig` for the "both or neither" refusal.
 */
export const langyConfig = Config.define((c) => ({
  agentUrl: c.env("LANGY_AGENT_URL", z.string().optional()),
  workerCallbackUrl: c.env("LANGY_WORKER_CALLBACK_URL", z.string().optional()),
  workerGatewayUrl: c.env("LANGY_WORKER_GATEWAY_URL", z.string().optional()),
  mirrorProjectId: c.env("LANGY_MIRROR_PROJECT_ID", z.string().optional()),
  gatewayInternalUrl,
  gatewayPublicUrl,
  gatewayLegacyUrl,
}));

export type LangyServerConfig = ConfigOf<typeof langyConfig>;

/**
 * Refuses an agent manager that is half configured. `internalSecret` arrives
 * resolved through the secrets member, so the caller passes it in alongside
 * the resolved config.
 */
export function assertLangyServerConfig(
  config: LangyServerConfig,
  internalSecret: string | undefined,
): void {
  const secret = internalSecret?.trim();
  const url = config.agentUrl?.trim();
  if (Boolean(url) === Boolean(secret) || !url) return;

  throw new Error(
    "The Langy agent manager's address needs its shared secret (LANGY_AGENT_URL is set, " +
      "LANGY_INTERNAL_SECRET is not). Set the secret, or remove the address to run without " +
      "an agent manager.",
  );
}

export const langySecrets = {
  internal: Secret.load("LANGY_INTERNAL_SECRET", { optional: true }),
} as const;

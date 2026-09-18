import { Config, type ConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";
import { z } from "zod";

/**
 * Where the agent manager answers. `internalSecret` resolves through
 * `LangyApp.secrets` (ADR-132), never this slice — see
 * `assertLangyServerConfig` for the "both or neither" refusal.
 */
export const langyConfig = Config.define((c) => ({
  agentUrl: c.env("LANGY_AGENT_URL", z.string().optional()),
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

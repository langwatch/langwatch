import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Where the agent manager answers and the bearer a callback from it carries.
 *
 * Refused TOGETHER: a URL alone dispatches unauthenticated, a secret alone
 * dispatches nowhere. Both absent is an ordinary deployment with no agent
 * manager, so absence is not a failure.
 */
export const langyServerConfigDefinition = RuntimeConfig.define({
  agentUrl: Config.value(z.string().optional(), { env: "LANGY_AGENT_URL" }),
  internalSecret: Config.optionalSecret({ env: "LANGY_INTERNAL_SECRET" }),
});

export type LangyServerConfig = ConfigValue<typeof langyServerConfigDefinition>;

export const langyServerConfigSchema = compileRuntimeConfig(langyServerConfigDefinition);

/** Refuses an agent manager that is half configured, at boot. */
export function assertLangyServerConfig(config: LangyServerConfig): void {
  const url = config.agentUrl?.trim();
  const secret = config.internalSecret?.trim();
  if (Boolean(url) === Boolean(secret)) return;

  throw new Error(
    "The Langy agent manager needs both its address and its shared secret " +
      "(LANGY_AGENT_URL and LANGY_INTERNAL_SECRET). Set the missing one, or remove both to run " +
      "without an agent manager.",
  );
}

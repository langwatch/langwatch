import { Config, compileRuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Where the agent manager answers and the bearer a callback from it carries.
 *
 * An address without its secret would dispatch unauthenticated, so the schema
 * refuses it. A secret without an address is an ordinary deployment with no
 * agent manager: the launcher writes the secret into `.env` once, and the
 * address exists only while the manager runs.
 */
export const langyServerConfigDefinition = Config.group(
  {
    agentUrl: Config.value(z.string().optional(), { env: "LANGY_AGENT_URL" }),
    internalSecret: Config.optionalSecret({ env: "LANGY_INTERNAL_SECRET" }),
  },
  [
    (value) =>
      value.agentUrl?.trim() && !value.internalSecret?.trim()
        ? {
            path: "internalSecret",
            message:
              "The Langy agent manager's address needs its shared secret (LANGY_AGENT_URL is set, " +
              "LANGY_INTERNAL_SECRET is not). Set the secret, or remove the address to run without " +
              "an agent manager.",
          }
        : undefined,
  ],
);

export type LangyServerConfig = ConfigValue<typeof langyServerConfigDefinition>;

export const langyServerConfigSchema = compileRuntimeConfig(langyServerConfigDefinition);

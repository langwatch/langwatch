import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config.ts";

/**
 * The one Postgres connection every process that reads or writes control-plane state opens.
 * Optional: a process given no database composes without one; it says so at boot rather
 * than refusing to start.
 */
export const postgresConfigDefinition = RuntimeConfig.define({
  url: Config.value(z.string().optional(), { env: "DATABASE_URL" }),
});

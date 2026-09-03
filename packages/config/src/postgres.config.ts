import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * The one Postgres connection every process that reads or writes control-plane
 * state opens, at the deployment's own spelling.
 *
 * Optional: a process given no database composes without one and says so at
 * boot, rather than refusing to start. What it cannot do is compose an
 * UNCONFIGURED client — a blank export is not a connection string, and a
 * client built over one would fail on its first query instead of at boot.
 */
export const postgresConfigDefinition = RuntimeConfig.define({
  url: Config.value(z.string().optional(), { env: "DATABASE_URL" }),
});

import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * The two Langy GitHub App leaves every process that mints installation
 * tokens or reports the connection's status reads identically.
 *
 * `privateKey` is deliberately NOT here: one caller treats a blank export as
 * unconfigured (a plain optional string) while another refuses a blank export
 * at parse time (`Config.secret`), so sharing that leaf would change one of
 * the two processes' boot behaviour. `appSlug` and `webhookSecret` are read by
 * only one caller today and stay there too.
 */
export const githubAppConfigDefinition = RuntimeConfig.define({
  appId: Config.value(z.string().optional(), { env: "GITHUB_LANGY_APP_ID" }),
  host: Config.value(z.string().optional(), { env: "GITHUB_LANGY_HOST" }),
});

import { z } from "zod";

import { Config } from "./runtime-config.ts";

/**
 * Canonical leaves for deployment facts several definitions legitimately
 * share. The compiler admits a re-bound env var only when the claimants are
 * this same instance, so one meaning is shared and two meanings still refuse.
 */
export const deploymentPublicBaseUrl = Config.value(z.string().optional(), { env: "BASE_HOST" });

/**
 * The deployment's one credentials secret: the secret module's cipher key and
 * github's install-state signing key read the same value on purpose.
 */
export const deploymentCredentialsSecret = Config.value(z.string().optional(), {
  env: "CREDENTIALS_SECRET",
});

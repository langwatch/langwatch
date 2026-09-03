import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * The two AuthZ switches every process interprets by the platform app's own
 * rule, at the deployment's own spelling.
 *
 * Both are read raw here and interpreted at each caller's resolve step —
 * `epochCache === "1" || epochCache === "true"` — rather than parsed at the
 * leaf, because that is the legacy reading the platform app already applies
 * and two processes disagreeing about whether a permission read may be served
 * from the epoch cache is worse than either answer. `demoProjectId` names the
 * one project everybody may read; blank is not a project id, so a caller
 * trims it to `undefined` rather than filtering on the empty string, which
 * would widen rather than narrow.
 */
export const authzConfigDefinition = RuntimeConfig.define({
  epochCache: Config.value(z.string().optional(), { env: "AUTHZ_EPOCH_CACHE" }),
  demoProjectId: Config.value(z.string().optional(), { env: "DEMO_PROJECT_ID" }),
});

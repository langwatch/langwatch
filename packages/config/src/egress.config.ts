import { z } from "zod";

import { Config, environmentOneOrTrueSchema, RuntimeConfig } from "./runtime-config";

/**
 * The address policy an outbound model-provider credential probe is judged
 * by, at the deployment's own spelling.
 *
 * `blockLocalHttpCalls` is read through `environmentOneOrTrueSchema` — `"1"`
 * or a case-insensitive `"true"`, and nothing else — because a probe answered
 * differently by two processes is a credential that saves on one screen and
 * fails on another. `allowedProxyHosts` is the literal allowlist that relaxes
 * only that block; it stays a raw comma-separated string here because
 * splitting, trimming and dropping blank entries is the same small step every
 * caller repeats at resolve time, not a parse this leaf should own.
 *
 * An unset allowlist is an empty one rather than a wildcard: a wildcard read
 * out of an absent variable is how a fence stops fencing without anyone
 * deciding it should.
 */
export const egressConfigDefinition = RuntimeConfig.define({
  blockLocalHttpCalls: Config.value(environmentOneOrTrueSchema, {
    env: "BLOCK_LOCAL_HTTP_CALLS",
  }),
  allowedProxyHosts: Config.value(z.string().optional(), { env: "ALLOWED_PROXY_HOSTS" }),
});

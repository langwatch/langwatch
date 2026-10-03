/**
 * Where this deployment's scenario children send `execute_sync`.
 *
 * Resolved by the parent, at prefetch time, and carried on the job. The child
 * cannot decide this for itself: the question is whether this deployment gives
 * each project its own engine, and the only evidence for that is
 * `LANGWATCH_NLP_LAMBDA_CONFIG`, which is the AWS credential that creates and
 * invokes those engines. It may invoke ANY project's function, so it stays in
 * the control plane and is not in the child's environment allowlist.
 *
 * Parent-only, because it reads the validated environment. The child runs
 * under `SKIP_ENV_VALIDATION` and builds its transport from the answer.
 */

import { env } from "~/env.mjs";
import type { ExecuteSyncRoute } from "./types";

/**
 * Decide how this deployment's scenario children reach nlpgo for one turn.
 *
 * @returns `relay` with the control plane's base URL when the deployment gives
 * each project its own engine, otherwise `direct` with the single engine's URL.
 */
export function resolveExecuteSyncRoute(): ExecuteSyncRoute {
  if (env.LANGWATCH_NLP_LAMBDA_CONFIG) {
    return { mode: "relay", relayBaseUrl: env.BASE_HOST };
  }
  // No per-project engines, so the child posts to the one engine there is.
  // This is every self-hosted install, and it is unchanged.
  return { mode: "direct", nlpServiceUrl: env.LANGWATCH_NLP_SERVICE! };
}

import { RUN_KEY_LIFETIME_MS } from "@langwatch/api-key-contract";

import { LAMBDA_INVOCATION_TIMEOUT_SECONDS } from "./nlp-lambda-config.rules.ts";

/** How long a Lambda dispatch's key must outlast the invocation timeout: the answer's way back. */
export const LAMBDA_DISPATCH_KEY_MARGIN_MS = 60 * 1000;

/**
 * The life a dispatch's key must still have when handed out. A Lambda dispatch is bound by its
 * invocation timeout; a self-hosted engine has no bound, so it gets a full fresh lifetime.
 */
export function dispatchKeyFloorMs({ onLambda }: { onLambda: boolean }): number {
  return onLambda
    ? LAMBDA_INVOCATION_TIMEOUT_SECONDS * 1000 + LAMBDA_DISPATCH_KEY_MARGIN_MS
    : RUN_KEY_LIFETIME_MS;
}

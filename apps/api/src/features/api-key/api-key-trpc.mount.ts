/**
 * App-process transport mount for the API-key vertical: the declared
 * `apiKey.*` transport on this process's runtime, and nothing bound around it.
 *
 * The curated audit entry each management write used to record here is gone.
 * It existed because the automatic mutation row masked `apiKeyId` — the
 * generic redaction read the name as credential material — so `revoke`, whose
 * answer carries no id, left a trail that could not say which key was
 * retired. The redaction now keeps an identifier, so the automatic row carries
 * everything the curated one did and the two are no longer written for the
 * same action.
 */

import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { apiKeyTrpcTransport } from "@langwatch/api-key-server";
import type { TrpcRuntime } from "@langwatch/api/trpc";

/** The one slice of the process context this namespace reads. */
export interface ApiKeyHostContext {
  app: Readonly<{ apiKeys: ApiKeyApi }>;
}

/** Mounts `apiKey.*` on the app process's declared tRPC runtime. */
export function createApiKeyTrpcRouter<TContext extends ApiKeyHostContext>(
  mount: Readonly<{ runtime: TrpcRuntime<TContext> }>,
) {
  return mount.runtime.mount(apiKeyTrpcTransport, (ctx) => ctx.app.apiKeys);
}

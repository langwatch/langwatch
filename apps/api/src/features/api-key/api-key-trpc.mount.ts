/**
 * App-process transport mount for the API-key vertical.
 *
 * Behaviour is package-owned (`@langwatch/api-key-server`); this supplies the
 * process's root, authenticated procedure, policy chain and audit sink.
 *
 * No procedure here declares a permission: an `apiKey:*` permission does not
 * exist, because a personal key belongs to its owner. `ApiKeyTrpcApi` proves
 * organization membership and ownership inside every handler, and each
 * procedure carries the written reason that records it — which is what keeps
 * the surface declared rather than merely unchecked.
 */
import { ApiKeyTrpcApi, type ApiKeyTrpcContext } from "@langwatch/api-key-server";
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * The process's audit trail. Fire and forget, as this router has always
 * recorded it: a credential response never waits on the audit write, and the
 * minted token is never among the arguments.
 */
type ApiKeyAuditSink = Readonly<{
  recordAudit(
    entry: Readonly<{
      userId: string;
      organizationId: string;
      action: string;
      args: Readonly<Record<string, unknown>>;
    }>,
  ): void;
}>;

/** Mounts `apiKey.*` on the app process's tRPC root. */
export function createApiKeyTrpcRouter<
  TContext extends ApiKeyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & ApiKeyAuditSink) {
  return ApiKeyTrpcApi.create(mount.root, createTrpcApiService(mount), {
    recordAudit: mount.recordAudit,
  });
}

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
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import {
  appTrpcNoPermissionPolicy,
  type AppTrpcPolicyMiddlewares,
} from "../../app-trpc/app-trpc.policy";

type ApiKeyMount<
  TContext extends ApiKeyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /**
   * The process's audit trail. Fire and forget, as this router has always
   * recorded it: a credential response never waits on the audit write, and the
   * minted token is never among the arguments.
   */
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
>(mount: ApiKeyMount<TContext, TOptions, TRoot>) {
  return ApiKeyTrpcApi.create(
    mount.root,
    {
      protected: mount.protectedProcedure,
      noPermission: appTrpcNoPermissionPolicy(mount.middlewares),
    },
    { recordAudit: mount.recordAudit },
  );
}

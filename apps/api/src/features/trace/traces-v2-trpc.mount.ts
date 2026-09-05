/**
 * App-process transport mounts for the trace EXPLORER, and for the one anonymous trace
 * read.
 */
import {
  appTrpcNoPermissionPolicy,
  createTrpcApiService,
  type AppTrpcPolicyMiddlewares,
  type TrpcApiMount,
  type TrpcApiPorts,
} from "@langwatch/api/trpc";
import {
  SharedTraceTrpcApi,
  TraceQueryClickHouseAdapter,
  TracesV2TrpcApi,
  type SharedTraceTrpcContext,
  type SharedTraceTrpcPorts,
  type TracesV2TrpcContext,
  type TracesV2TrpcPorts,
} from "@langwatch/trace-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * Mounts `tracesV2.*` on the app process's tRPC root. The ports are forwarded untouched.
 */
export function createTracesV2TrpcRouter<
  TContext extends TracesV2TrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TMetadata,
  TMetadataRaw,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<Omit<TracesV2TrpcPorts<TMetadata, TMetadataRaw>, "queryTranslation">>,
) {
  return TracesV2TrpcApi.create(mount.root, createTrpcApiService(mount), {
    ...mount.ports,
    queryTranslation: {
      translateFilterToClickHouse: TraceQueryClickHouseAdapter.translateFilter,
      extractFreeTextTerms: TraceQueryClickHouseAdapter.extractFreeTextTerms,
    },
  });
}

type SharedTraceMount<
  TContext extends SharedTraceTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  /** The PUBLIC procedure: this surface is reachable with no session. */
  publicProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  ports: SharedTraceTrpcPorts;
}>;

/**
 * Mounts `sharedTrace.*` on the app process's tRPC root. The policy is `noPermission`,
 * not a permission: there is no permission to check on a request with no actor, and the
 * declaration is what keeps the procedure reviewable rather than merely unchecked.
 */
export function createSharedTraceTrpcRouter<
  TContext extends SharedTraceTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: SharedTraceMount<TContext, TOptions, TRoot>) {
  return SharedTraceTrpcApi.create(
    mount.root,
    {
      public: mount.publicProcedure,
      noPermission: appTrpcNoPermissionPolicy(mount.middlewares),
    },
    mount.ports,
  );
}

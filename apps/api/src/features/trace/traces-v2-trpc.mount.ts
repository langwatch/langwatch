/**
 * App-process transport mounts for the trace EXPLORER, and for the one
 * anonymous trace read.
 *
 * Behaviour is package-owned (`@langwatch/trace-server`); these supply the
 * process's tRPC root, its procedures, its policy chain, and the capabilities
 * Trace does not own — the viewer's protections, the plan's visibility window,
 * the AI composer, the data-privacy vocabulary, and the span display and
 * redaction passes the legacy trace read still owns.
 *
 * `sharedTrace.get` gets its OWN mount and its own procedure (`public`, not
 * `protected`) because ADR-057 keeps the single anonymous trace read on its
 * own surface. Nothing else in this file is reachable without a session.
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
  TraceQueryClickHouse,
  TracesV2TrpcApi,
  type SharedTraceTrpcContext,
  type SharedTraceTrpcPorts,
  type TracesV2TrpcContext,
  type TracesV2TrpcPorts,
} from "@langwatch/trace-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * Mounts `tracesV2.*` on the app process's tRPC root.
 *
 * The ports are forwarded untouched. Every entry is another vertical's
 * capability: the viewer's redactions and the plan window, the composer's model
 * providers, the data-privacy content catalog, the legacy span display and
 * redaction passes, and the reserved-metadata write.
 *
 * `queryTranslation` is the one exception and is filled in here rather than by
 * the caller: it is Trace's OWN query translator, injected only because strict
 * layout forbids an API module from importing its feature's ClickHouse adapter.
 * No process should have to know that.
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
      translateFilterToClickHouse: TraceQueryClickHouse.translateFilter,
      extractFreeTextTerms: TraceQueryClickHouse.extractFreeTextTerms,
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
 * Mounts `sharedTrace.*` on the app process's tRPC root.
 *
 * The policy is `noPermission`, not a permission: there is no permission to
 * check on a request with no actor, and the declaration is what keeps the
 * procedure reviewable rather than merely unchecked. The share token in the
 * input is the whole authorization, and `ShareService.resolveForViewer` is
 * what redeems it.
 *
 * It keeps its own mount type because there is no authenticated procedure here
 * for `createTrpcApiService` to compose a chain around.
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

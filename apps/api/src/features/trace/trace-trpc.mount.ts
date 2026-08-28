/**
 * App-process transport mounts for the trace vertical.
 *
 * Behaviour is package-owned (`@langwatch/trace-server`); these supply the
 * process's tRPC root, its authenticated procedure, its policy chain, and the
 * capabilities Trace does not own — the caller's read-time redactions, the
 * shared filter schemas, the reviewer-correction redaction rules and the
 * evaluator wizard's precondition engine.
 *
 * The anonymous `sharedTrace.get` read is NOT mounted here. ADR-057 keeps the
 * single public trace read on its own surface, and nothing in this file is
 * reachable without a session.
 */
import type { TraceLegacyFilterInput, TraceLegacyListInput } from "@langwatch/trace-contract";
import {
  SpansTrpcApi,
  TraceEditOverlayTrpcApi,
  TracesTrpcApi,
  type SpansTrpcContext,
  type SpansTrpcPorts,
  type TraceEditOverlayTrpcContext,
  type TraceEditOverlayTrpcPorts,
  type TraceEditOverlayVisibilityWindow,
  type TracesTrpcContext,
  type TracesTrpcPorts,
} from "@langwatch/trace-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { appTrpcPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type SpansMount<
  TContext extends SpansTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /** Forwarded untouched: the viewer's redactions are the process's to resolve. */
  ports: SpansTrpcPorts;
}>;

/** Mounts `spans.*` on the app process's tRPC root. */
export function createSpansTrpcRouter<
  TContext extends SpansTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: SpansMount<TContext, TOptions, TRoot>) {
  return SpansTrpcApi.create(
    mount.root,
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    mount.ports,
  );
}

type TraceEditOverlayMount<
  TContext extends TraceEditOverlayTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TProtections extends TraceEditOverlayVisibilityWindow,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /**
   * Forwarded untouched. Both redaction rules are the ones the legacy trace
   * read applies to the captured value, so a correction can never be handed
   * over more freely than the content it corrects.
   */
  ports: TraceEditOverlayTrpcPorts<TProtections>;
}>;

/** Mounts `traceEditOverlay.*` on the app process's tRPC root. */
export function createTraceEditOverlayTrpcRouter<
  TContext extends TraceEditOverlayTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TProtections extends TraceEditOverlayVisibilityWindow,
>(mount: TraceEditOverlayMount<TContext, TOptions, TRoot, TProtections>) {
  return TraceEditOverlayTrpcApi.create(
    mount.root,
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    mount.ports,
  );
}

type TracesMount<
  TContext extends TracesTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TListInput extends TraceLegacyListInput,
  TListInputRaw,
  TFilterInput extends TraceLegacyFilterInput,
  TFilterInputRaw,
  TPrecondition,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /**
   * Forwarded untouched. The two filter schemas are the process's because the
   * same shapes are the v1 REST search body and the analytics read input: one
   * definition, in the process, is what keeps those surfaces from drifting.
   */
  ports: TracesTrpcPorts<TListInput, TListInputRaw, TFilterInput, TFilterInputRaw, TPrecondition>;
}>;

/** Mounts `traces.*` on the app process's tRPC root. */
export function createTracesTrpcRouter<
  TContext extends TracesTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TListInput extends TraceLegacyListInput,
  TListInputRaw,
  TFilterInput extends TraceLegacyFilterInput,
  TFilterInputRaw,
  TPrecondition,
>(
  mount: TracesMount<
    TContext,
    TOptions,
    TRoot,
    TListInput,
    TListInputRaw,
    TFilterInput,
    TFilterInputRaw,
    TPrecondition
  >,
) {
  return TracesTrpcApi.create(
    mount.root,
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    mount.ports,
  );
}

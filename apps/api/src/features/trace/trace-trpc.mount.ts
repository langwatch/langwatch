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
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
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
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * Mounts `spans.*` on the app process's tRPC root.
 *
 * The ports are forwarded untouched: the viewer's redactions are the process's
 * to resolve.
 */
export function createSpansTrpcRouter<
  TContext extends SpansTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<SpansTrpcPorts>) {
  return SpansTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/**
 * Mounts `traceEditOverlay.*` on the app process's tRPC root.
 *
 * The ports are forwarded untouched. Both redaction rules are the ones the
 * legacy trace read applies to the captured value, so a correction can never be
 * handed over more freely than the content it corrects.
 */
export function createTraceEditOverlayTrpcRouter<
  TContext extends TraceEditOverlayTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TProtections extends TraceEditOverlayVisibilityWindow,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<TraceEditOverlayTrpcPorts<TProtections>>,
) {
  return TraceEditOverlayTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/**
 * Mounts `traces.*` on the app process's tRPC root.
 *
 * The ports are forwarded untouched. The two filter schemas are the process's
 * because the same shapes are the v1 REST search body and the analytics read
 * input: one definition, in the process, is what keeps those surfaces from
 * drifting.
 */
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
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<
      TracesTrpcPorts<TListInput, TListInputRaw, TFilterInput, TFilterInputRaw, TPrecondition>
    >,
) {
  return TracesTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

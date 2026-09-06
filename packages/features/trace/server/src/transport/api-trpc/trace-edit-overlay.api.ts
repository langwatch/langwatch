/**
 * Reviewer corrections for a trace, over the process's tRPC transport. Reading needs permission
 * to view traces; writing needs permission to update annotations, the same family the
 * suggest-an-output flow sits in. A correction quotes the trace it corrects, so the read applies
 * the same content gates the trace itself would. Transport only — the two redaction rules
 * arrive as ports, the same functions the legacy trace read applies.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  traceEditOverlayDtoSchema,
  traceEditOverlayOrNullSchema,
  traceEditOverlayPatchSchema,
  type TraceEditOverlayPatch,
} from "@langwatch/trace-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { TraceApp } from "#app/trace.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. `actor()` is who the write
 * is attributed to — read here, stamped once, by the application.
 */
export type TraceEditOverlayTrpcContext = Readonly<{
  app: Readonly<{ traces: TraceApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type TraceEditOverlayTrpcProcedures<
  TContext extends TraceEditOverlayTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * Applied AFTER this feature's own input parser: the authorization check reads its scope id
   * from the validated input, and tRPC runs middlewares in the order they were added.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
  /** Whether the chain checks every answer against its declared output schema. */
  validateOutput: boolean;
}>;

/**
 * The one field of the viewer's protections this transport reads for itself.
 * Everything else it holds is passed through to the redaction rules below.
 */
export type TraceEditOverlayVisibilityWindow = Readonly<{
  /** Traces that occurred before this epoch-ms cutoff are teased. */
  visibilityCutoffMs?: number | null;
}>;

/** The process capabilities this transport needs that Trace does not own. */
export type TraceEditOverlayTrpcPorts<TProtections extends TraceEditOverlayVisibilityWindow> =
  Readonly<{
    /** The caller's read-time redactions for one project. */
    getViewerProtections(
      ctx: unknown,
      input: Readonly<{ projectId: string }>,
    ): Promise<TProtections>;
    /**
     * Drops or placeholder-replaces every corrected value this reader may not
     * read. The same rule the trace read applies to the captured value.
     */
    redactPatchForViewer(
      input: Readonly<{
        patch: TraceEditOverlayPatch;
        protections: TProtections;
        isWindowRedacted: boolean;
      }>,
    ): TraceEditOverlayPatch;
    /**
     * Puts back the edits the reader was never handed, so saving over a
     * correction the reader only partly saw does not delete the rest of it.
     */
    restoreWithheldEdits(
      input: Readonly<{
        incoming: TraceEditOverlayPatch;
        stored: TraceEditOverlayPatch;
        protections: TProtections;
        isWindowRedacted: boolean;
      }>,
    ): TraceEditOverlayPatch;
  }>;

const traceScopeSchema = z.object({ projectId: z.string(), traceId: z.string() });

const upsertInputSchema = traceScopeSchema.extend({
  patch: traceEditOverlayPatchSchema,
});

/** Installs the complete `traceEditOverlay.*` surface on a process-owned root. */
export class TraceEditOverlayTrpcApi {
  static create<
    TContext extends TraceEditOverlayTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TProtections extends TraceEditOverlayVisibilityWindow,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: TraceEditOverlayTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TraceEditOverlayTrpcPorts<TProtections>,
  ) {
    return (
      createTrpcService({
        root: trpc,
        procedures,
        validateOutput: procedures.validateOutput,
      })
        .query("getByTraceId", (p) =>
          p
            .withInput(traceScopeSchema)
            .withOutput(traceEditOverlayOrNullSchema)
            .withPermission("traces:view")
            .handle(async ({ ctx, input }) => {
              const overlay = await ctx.app.traces.readTraceEditOverlay({
                projectId: input.projectId,
                traceId: input.traceId,
              });
              if (!overlay) return null;

              const protections = await ports.getViewerProtections(ctx, {
                projectId: input.projectId,
              });
              const isWindowRedacted = await ctx.app.traces.isTraceWindowRedacted({
                projectId: input.projectId,
                traceId: input.traceId,
                visibilityCutoffMs: protections.visibilityCutoffMs,
              });

              return {
                ...overlay,
                patch: ports.redactPatchForViewer({
                  patch: overlay.patch,
                  protections,
                  isWindowRedacted,
                }),
              };
            }),
        )
        /**
         * Saves the correction, replacing the previous one.
         *
         * The saved patch is composed on top of what the read handed the caller,
         * so the edits withheld from them are carried over rather than dropped,
         * and the answer that goes back is redacted the same way the read is.
         * Removing a correction outright stays the separate, deliberate `delete`.
         */
        .mutation("upsert", (p) =>
          p
            .withInput(upsertInputSchema)
            .withOutput(traceEditOverlayDtoSchema)
            .withPermission("annotations:update")
            .handle(async ({ ctx, input }) => {
              const stored = await ctx.app.traces.readTraceEditOverlay({
                projectId: input.projectId,
                traceId: input.traceId,
              });

              // The first correction on a trace has nothing to carry over and
              // nothing to redact: the answer is the caller's own patch.
              if (!stored) {
                return ctx.app.traces.saveTraceEditOverlay(
                  {
                    projectId: input.projectId,
                    traceId: input.traceId,
                    patch: input.patch,
                  },
                  ctx.actor(),
                );
              }

              const protections = await ports.getViewerProtections(ctx, {
                projectId: input.projectId,
              });
              const isWindowRedacted = await ctx.app.traces.isTraceWindowRedacted({
                projectId: input.projectId,
                traceId: input.traceId,
                visibilityCutoffMs: protections.visibilityCutoffMs,
              });

              const saved = await ctx.app.traces.saveTraceEditOverlay(
                {
                  projectId: input.projectId,
                  traceId: input.traceId,
                  patch: ports.restoreWithheldEdits({
                    incoming: input.patch,
                    stored: stored.patch,
                    protections,
                    isWindowRedacted,
                  }),
                },
                ctx.actor(),
              );

              return {
                ...saved,
                patch: ports.redactPatchForViewer({
                  patch: saved.patch,
                  protections,
                  isWindowRedacted,
                }),
              };
            }),
        )
        .mutation("delete", (p) =>
          p
            .withInput(traceScopeSchema)
            .withOutput(z.void())
            .withPermission("annotations:update")
            .handle(async ({ ctx, input }) => {
              await ctx.app.traces.deleteTraceEditOverlay({
                projectId: input.projectId,
                traceId: input.traceId,
              });
            }),
        )
        .build()
    );
  }
}

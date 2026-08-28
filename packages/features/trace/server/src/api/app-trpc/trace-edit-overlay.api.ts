/**
 * Reviewer corrections for a trace, over the process's tRPC transport.
 *
 *   getByTraceId: the correction stored on a trace, redacted for this reader.
 *   upsert:       replaces it, carrying over the edits this reader never saw.
 *   delete:       removes it outright.
 *
 * Reading one needs permission to view traces; writing one needs permission to
 * update annotations. Correcting a trace is review work, and external reviewers
 * hold annotation permissions rather than trace ones, which is the same family
 * the suggest-an-output flow already sits in.
 *
 * A correction quotes the trace it corrects, so the read applies the same
 * content gates the trace itself would: the caller's privacy policy and the
 * plan's visibility window decide which edits come back.
 *
 * Transport only. The two redaction rules arrive as ports because they are the
 * same functions the legacy trace read applies, and that read has not left the
 * application yet.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  traceEditOverlayPatchSchema,
  type TraceEditOverlayDto,
  type TraceEditOverlayPatch,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

const logger = createLogger("langwatch:api:trace-edit-overlay");

/** The stored corrections, as this transport reads and writes them. */
type TraceEditOverlayStore = Readonly<{
  getByTraceId(
    input: Readonly<{ projectId: string; traceId: string }>,
  ): Promise<TraceEditOverlayDto | null>;
  upsert(
    input: Readonly<{
      projectId: string;
      traceId: string;
      patch: unknown;
      userId: string | null;
    }>,
  ): Promise<TraceEditOverlayDto>;
  delete(input: Readonly<{ projectId: string; traceId: string }>): Promise<void>;
}>;

/**
 * The trace's own summary read. Only its visibility-window verdict is used
 * here, but it is the same read the drawer header makes, which is what keeps
 * the two from disagreeing about whether a trace is teased.
 */
type TraceSummaryReader = Readonly<{
  getByTraceId(
    tenantId: string,
    traceId: string,
    options?: Readonly<{ visibilityCutoffMs?: number | null; full?: boolean }>,
  ): Promise<TraceSummaryData>;
}>;

type TraceEditOverlayApplication = Readonly<{
  traces: Readonly<{ editOverlay: TraceEditOverlayStore; summary: TraceSummaryReader }>;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type TraceEditOverlayTrpcContext = Readonly<{
  app: TraceEditOverlayApplication;
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
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
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

/**
 * Whether the plan's visibility window teases this trace's content. Only free
 * plans have a window, so a plan without one answers without reading anything;
 * when there is one, the trace's own summary decides it, the same read the
 * drawer header uses. A summary that cannot be read answers "teased": a
 * correction quotes captured content, so a trace whose age we cannot establish
 * must not open it.
 */
async function isTraceWindowRedacted({
  projectId,
  traceId,
  visibilityCutoffMs,
  traceSummary,
}: {
  projectId: string;
  traceId: string;
  visibilityCutoffMs: number | null | undefined;
  traceSummary: TraceSummaryReader;
}): Promise<boolean> {
  if (visibilityCutoffMs === null || visibilityCutoffMs === undefined) {
    return false;
  }
  try {
    const summary = await traceSummary.getByTraceId(projectId, traceId, {
      visibilityCutoffMs,
      full: false,
    });
    return summary.redactedByVisibilityWindow === true;
  } catch (error) {
    logger.warn(
      { error, projectId, traceId },
      "trace summary unreadable; withholding corrected content",
    );
    return true;
  }
}

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
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      getByTraceId: policy("traces:view")(procedure.input(traceScopeSchema)).query(
        async ({ ctx, input }) => {
          const overlay = await ctx.app.traces.editOverlay.getByTraceId({
            projectId: input.projectId,
            traceId: input.traceId,
          });
          if (!overlay) return null;

          const protections = await ports.getViewerProtections(ctx, {
            projectId: input.projectId,
          });
          const isWindowRedacted = await isTraceWindowRedacted({
            projectId: input.projectId,
            traceId: input.traceId,
            visibilityCutoffMs: protections.visibilityCutoffMs,
            traceSummary: ctx.app.traces.summary,
          });

          return {
            ...overlay,
            patch: ports.redactPatchForViewer({
              patch: overlay.patch,
              protections,
              isWindowRedacted,
            }),
          };
        },
      ),

      /**
       * Saves the correction, replacing the previous one.
       *
       * The saved patch is composed on top of what the read handed the caller,
       * so the edits withheld from them are carried over rather than dropped,
       * and the answer that goes back is redacted the same way the read is.
       * Removing a correction outright stays the separate, deliberate `delete`.
       */
      upsert: policy("annotations:update")(procedure.input(upsertInputSchema)).mutation(
        async ({ ctx, input }) => {
          const editOverlay = ctx.app.traces.editOverlay;
          const stored = await editOverlay.getByTraceId({
            projectId: input.projectId,
            traceId: input.traceId,
          });

          // The first correction on a trace has nothing to carry over and
          // nothing to redact: the answer is the caller's own patch.
          if (!stored) {
            return editOverlay.upsert({
              projectId: input.projectId,
              traceId: input.traceId,
              patch: input.patch,
              userId: ctx.actor().id,
            });
          }

          const protections = await ports.getViewerProtections(ctx, {
            projectId: input.projectId,
          });
          const isWindowRedacted = await isTraceWindowRedacted({
            projectId: input.projectId,
            traceId: input.traceId,
            visibilityCutoffMs: protections.visibilityCutoffMs,
            traceSummary: ctx.app.traces.summary,
          });

          const saved = await editOverlay.upsert({
            projectId: input.projectId,
            traceId: input.traceId,
            patch: ports.restoreWithheldEdits({
              incoming: input.patch,
              stored: stored.patch,
              protections,
              isWindowRedacted,
            }),
            userId: ctx.actor().id,
          });

          return {
            ...saved,
            patch: ports.redactPatchForViewer({
              patch: saved.patch,
              protections,
              isWindowRedacted,
            }),
          };
        },
      ),

      delete: policy("annotations:update")(procedure.input(traceScopeSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.traces.editOverlay.delete({
            projectId: input.projectId,
            traceId: input.traceId,
          });
        },
      ),
    });
  }
}

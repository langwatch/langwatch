/**
 * A trace's spans over the process's tRPC transport. Both procedures take `traces:view` — a
 * span is trace content, and nothing here is readable to a caller who may not read the trace it
 * belongs to. Transport only: the waterfall order is the application's, not this door's, and the
 * viewer's redactions are resolved by the process and handed to the read unchanged.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { promptStudioSpanSchema, spansForTraceSchema } from "@langwatch/trace-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { TraceApp } from "#app/trace.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type SpansTrpcContext = Readonly<{ app: Readonly<{ traces: TraceApp }> }>;

type SpansTrpcProcedures<
  TContext extends SpansTrpcContext,
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

/** The process capabilities this transport needs that Trace does not own. */
export type SpansTrpcPorts = Readonly<{
  /**
   * The caller's read-time redactions for one project: cost visibility, the
   * data-privacy policy's content categories, the restricted-attribute rules
   * and the plan's visibility cutoff. Resolved per request because they depend
   * on the session, and passed straight through to the read.
   */
  getViewerProtections(ctx: unknown, input: Readonly<{ projectId: string }>): Promise<unknown>;
}>;

const traceScopeSchema = z.object({ projectId: z.string(), traceId: z.string() });
const spanScopeSchema = z.object({ projectId: z.string(), spanId: z.string() });

/** Installs the complete `spans.*` tRPC surface on a process-owned root. */
export class SpansTrpcApi {
  static create<
    TContext extends SpansTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SpansTrpcProcedures<TContext, TOptions, TRoot>,
    ports: SpansTrpcPorts,
  ) {
    return createTrpcService({
      root: trpc,
      procedures,
      validateOutput: procedures.validateOutput,
    })
      .query("getAllForTrace", (p) =>
        p
          .withInput(traceScopeSchema)
          .withOutput(spansForTraceSchema)
          .withPermission("traces:view")
          .handle(async ({ ctx, input }) => {
            const protections = await ports.getViewerProtections(ctx, {
              projectId: input.projectId,
            });

            return ctx.app.traces.readOrderedSpansForTrace({
              projectId: input.projectId,
              traceId: input.traceId,
              protections,
            });
          }),
      )
      .query("getForPromptStudio", (p) =>
        p
          .withInput(spanScopeSchema)
          .withOutput(promptStudioSpanSchema)
          .withPermission("traces:view")
          .handle(async ({ ctx, input }) => {
            const { projectId, spanId } = input;

            const protections = await ports.getViewerProtections(ctx, { projectId });

            const result = await ctx.app.traces.readPromptStudioSpan({
              projectId,
              spanId,
              protections,
            });

            if (!result) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Span not found or is not an LLM span.",
              });
            }

            return result;
          }),
      )
      .build();
  }
}

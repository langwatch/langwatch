/**
 * Machine translation of content a reader is already looking at, over the
 * process's tRPC transport.
 *
 * Owned by model-provider rather than by traces: what the procedure decides is
 * which configured model answers and how a provider failure is reported. The
 * text arrives from the caller; nothing here reads a trace.
 *
 * Transport only: gate, input parsing and delegation to `ModelProviderService`.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  featureByKey,
  type ModelProviderService,
  type ModelRole,
} from "@langwatch/model-provider-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const TRANSLATE_FEATURE_KEY = "translate.text";

/**
 * The app's `TRANSLATE_TEXT_MAX_CHARS`. A ceiling on the wire, not a product
 * rule: past it the request is a paste of something nobody is reading.
 */
const TRANSLATE_TEXT_MAX_CHARS = 100_000;

type TranslateApplication = Readonly<{ modelProviders: ModelProviderService }>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type TranslateTrpcContext = Readonly<{ app: TranslateApplication }>;

type TranslateTrpcProcedures<
  TContext extends TranslateTrpcContext,
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

/** The process capability this transport needs; the failure policy is the app's. */
export type TranslateTrpcPorts = Readonly<{
  /**
   * Runs one model call for a named feature, turning any provider or SDK
   * failure into this application's typed `ai_call_failed` cause and logging
   * the provider's own words server-side, where internals belong.
   */
  wrapAiCall<T>(
    feature: Readonly<{ key: string; role: ModelRole; displayName: string }>,
    call: () => Promise<T>,
  ): Promise<T>;
}>;

const translateInputSchema = z.object({
  projectId: z.string(),
  textToTranslate: z.string().max(TRANSLATE_TEXT_MAX_CHARS),
});

/** Installs the complete `translate.*` tRPC surface on a process-owned root. */
export class TranslateTrpcApi {
  static create<
    TContext extends TranslateTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: TranslateTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TranslateTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      // Translation reads content the caller can already see — gate on the
      // same permission that grants viewing the trace, so read-only members
      // (VIEWER, demo/public view) aren't shown an action that then 403s.
      translate: policy("traces:view")(procedure.input(translateInputSchema)).mutation(
        async ({ ctx, input }) => {
          const feature = featureByKey(TRANSLATE_FEATURE_KEY);
          if (!feature) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `${TRANSLATE_FEATURE_KEY} feature is not registered`,
            });
          }

          // Any provider/SDK failure during the call surfaces as a typed
          // AiCallFailedError → "double-check your model configuration" toast
          // carrying the real (truncated) provider error message. `wrapAiCall`
          // truncates that message to the first line for the client and logs
          // the FULL underlying error server-side — the later lines (provider
          // status bodies, gateway 404 detail) are what prod triage needs.
          const { translation } = await ports.wrapAiCall(feature, () =>
            ctx.app.modelProviders.translate({
              projectId: input.projectId,
              text: input.textToTranslate,
            }),
          );

          return { translation };
        },
      ),
    });
  }
}

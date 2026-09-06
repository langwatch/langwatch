/**
 * Machine translation over tRPC. Owned by model-provider, not traces: the
 * procedure only picks a model and reports failures; text comes from the caller.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { featureByKey, type ModelRole } from "@langwatch/model-provider-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { ModelProviderApp } from "#app/model-provider.app";

const TRANSLATE_FEATURE_KEY = "translate.text";

/**
 * The app's `TRANSLATE_TEXT_MAX_CHARS`. A ceiling on the wire, not a product
 * rule: past it the request is a paste of something nobody is reading.
 */
const TRANSLATE_TEXT_MAX_CHARS = 100_000;

/** Auth from the process; `app` is the {@link ModelProviderApp} the provider/cost surfaces use. */
export type TranslateTrpcContext = Readonly<{
  app: Readonly<{ modelProviders: ModelProviderApp }>;
}>;

type TranslateTrpcProcedures<
  TContext extends TranslateTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** Applied after this feature's parser: reads its scope id from validated input. */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
  /** Whether the chain checks every answer against its declared output schema. */
  validateOutput: boolean;
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
    return (
      createTrpcService({
        root: trpc,
        procedures,
        validateOutput: procedures.validateOutput,
      })
        // Gated on trace-view, not a translate-specific permission: read-only members
        // must not be shown an action that then 403s.
        .mutation("translate", (p) =>
          p
            .withInput(translateInputSchema)
            .withOutput(z.object({ translation: z.string() }))
            .withPermission("traces:view")
            .handle(async ({ ctx, input }) => {
              const feature = featureByKey(TRANSLATE_FEATURE_KEY);
              // A missing registry entry is a build-time mistake, not a customer-actionable
              // cause, so it stays a plain Error and degrades to unknown + trace id.
              if (!feature) {
                throw new Error(`${TRANSLATE_FEATURE_KEY} feature is not registered`);
              }

              // wrapAiCall truncates the provider error to its first line for the client
              // and logs the full error server-side, where triage needs it.
              const { translation } = await ports.wrapAiCall(feature, () =>
                ctx.app.modelProviders.translate({
                  projectId: input.projectId,
                  text: input.textToTranslate,
                }),
              );

              return { translation };
            }),
        )
        .build()
    );
  }
}

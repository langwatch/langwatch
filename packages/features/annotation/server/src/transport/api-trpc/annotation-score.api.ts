/**
 * The project's annotation score definitions over a host's tRPC transport.
 *
 *   upsert:       create a score definition, or replace an existing one's
 *                 label, type, options and default. The settings surface.
 *   getAll:       every definition the project has, active or not.
 *   getAllActive: only the ones a reviewer can still pick, for the annotation
 *                 form and the queue configuration.
 *   getById:      one definition, for the editor.
 *   toggle:       retire a definition without losing the scores already
 *                 recorded against it, or bring it back.
 *   delete:       remove the definition for good.
 *
 * Reading takes `annotations:view`; defining takes `annotations:manage`,
 * retiring `annotations:update`, and removing `annotations:delete`.
 *
 * Transport only: policy and delegation to {@link AnnotationApp}.
 *
 * Spec: packages/features/annotation/specs/annotation-service.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { AnnotationApp } from "#app/annotation.app";

/**
 * The host supplies authentication; authorization arrives as `policy`.
 *
 * The same slice the comment door takes, and the same {@link AnnotationApp}
 * object: one application, two doors. Before it, this door declared
 * `Readonly<{ annotations: AnnotationService }>` and the comment door declared
 * a wider bag of its own, and neither could reach the other's.
 */
export type AnnotationScoreTrpcContext = Readonly<{
  app: Readonly<{ annotations: AnnotationApp }>;
}>;

type AnnotationScoreTrpcProcedures<
  TContext extends AnnotationScoreTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The host's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The host's tracing, logging, error, scope-lineage, authorization and audit
   * policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

const projectScopeSchema = z.object({ projectId: z.string() });

const upsertInputSchema = z.object({
  annotationScoreId: z.string().optional().nullable(),
  projectId: z.string(),
  name: z.string(),
  dataType: z.enum(["OPTION", "CHECKBOX", "BOOLEAN", "LIKERT", "CATEGORICAL"]),
  description: z.string().optional().nullable(),
  options: z.array(z.string()).optional().nullable(),
  category: z.array(z.string()).optional().nullable(),
  categoryExplanation: z.array(z.string()).optional().nullable(),
  radioCheckboxOptions: z.array(z.string()),
  defaultRadioOption: z.string().optional().nullable(),
  defaultCheckboxOption: z.array(z.string()).optional().nullable(),
});

const scoreScopeSchema = z.object({
  projectId: z.string(),
  scoreId: z.string(),
});

const toggleInputSchema = z.object({
  scoreId: z.string(),
  active: z.boolean(),
  projectId: z.string(),
});

/**
 * Installs the complete `annotationScore.*` tRPC surface on a host-owned root.
 * The procedure and the policy are injected by the host so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class AnnotationScoreTrpcApi {
  static create<
    TContext extends AnnotationScoreTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: AnnotationScoreTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      upsert: policy("annotations:manage")(procedure.input(upsertInputSchema)).mutation(
        async ({ ctx, input }) => {
          const options = (input.radioCheckboxOptions ?? []).map((option) => ({
            label: option,
            value: option,
          }));

          return ctx.app.annotations.upsertScore({
            id: input.annotationScoreId || nanoid(),
            projectId: input.projectId,
            name: input.name,
            dataType: input.dataType,
            description: input.description ?? "",
            options,
            defaultValue: {
              value: input.defaultRadioOption ?? null,
              options: input.defaultCheckboxOption ?? null,
            },
          });
        },
      ),

      getAll: policy("annotations:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) => ctx.app.annotations.listScores({ projectId: input.projectId }),
      ),

      getAllActive: policy("annotations:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) =>
          ctx.app.annotations.listScores({
            projectId: input.projectId,
            activeOnly: true,
          }),
      ),

      getById: policy("annotations:view")(procedure.input(scoreScopeSchema)).query(
        async ({ ctx, input }) =>
          ctx.app.annotations.getScore({
            id: input.scoreId,
            projectId: input.projectId,
          }),
      ),

      toggle: policy("annotations:update")(procedure.input(toggleInputSchema)).mutation(
        async ({ ctx, input }) =>
          ctx.app.annotations.toggleScore({
            id: input.scoreId,
            projectId: input.projectId,
            active: input.active,
          }),
      ),

      delete: policy("annotations:delete")(procedure.input(scoreScopeSchema)).mutation(
        async ({ ctx, input }) =>
          ctx.app.annotations.deleteScore({
            id: input.scoreId,
            projectId: input.projectId,
          }),
      ),
    });
  }
}

import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import {
  createSecretInputSchema,
  deleteSecretInputSchema,
  listSecretsInputSchema,
  secretIdSchema,
  secretProjectIdSchema,
  secretValueSchema,
  type SecretService,
} from "@langwatch/secret-contract";
import { z } from "zod";

type SecretApplication = Readonly<{ secrets: SecretService }>;
export type SecretTrpcContext = Readonly<{
  app: SecretApplication;
  actor(): Readonly<{ id: string }>;
  authorize(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<void>;
}>;
type SecretTrpcProcedures<
  TContext extends SecretTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
}>;
const legacyUpdateInputSchema = z
  .object({ projectId: secretProjectIdSchema, secretId: secretIdSchema, value: secretValueSchema })
  .strict();
const legacyDeleteInputSchema = deleteSecretInputSchema
  .omit({ id: true })
  .extend({ secretId: secretIdSchema });
/** Installs Secret on the process-owned tRPC root and its policy procedures. */
export class SecretTrpcApi {
  static create<
    TContext extends SecretTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SecretTrpcProcedures<TContext, TOptions, TRoot> = {
      protected: trpc.procedure,
    },
  ) {
    const procedure = procedures.protected;

    return trpc.router({
      list: procedure.input(listSecretsInputSchema).query(async ({ ctx, input }) => {
        ctx.actor();
        await ctx.authorize("secrets:view", { projectId: input.projectId });
        return ctx.app.secrets.list(input);
      }),
      create: procedure
        .input(createSecretInputSchema.omit({ actorId: true }))
        .mutation(async ({ ctx, input }) => {
          const actor = ctx.actor();
          await ctx.authorize("secrets:manage", { projectId: input.projectId });
          return ctx.app.secrets.create({ ...input, actorId: actor.id });
        }),
      update: procedure.input(legacyUpdateInputSchema).mutation(async ({ ctx, input }) => {
        const actor = ctx.actor();
        await ctx.authorize("secrets:manage", { projectId: input.projectId });
        await ctx.app.secrets.update({
          projectId: input.projectId,
          id: input.secretId,
          value: input.value,
          actorId: actor.id,
        });
        return { success: true };
      }),
      delete: procedure.input(legacyDeleteInputSchema).mutation(async ({ ctx, input }) => {
        ctx.actor();
        await ctx.authorize("secrets:manage", { projectId: input.projectId });
        await ctx.app.secrets.delete({ projectId: input.projectId, id: input.secretId });
        return { success: true };
      }),
    });
  }
}

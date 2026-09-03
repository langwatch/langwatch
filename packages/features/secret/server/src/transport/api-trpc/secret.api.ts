/**
 * The project's secrets over a host's tRPC transport.
 *
 *   list:   the project's customer-owned secrets, metadata only.
 *   create: a new secret, encrypted before it is stored.
 *   update: a new value for an existing secret.
 *   delete: removal of one secret from the project.
 *
 * Reading takes `secrets:view`; every write takes `secrets:manage`, because a
 * secret is a live credential for whatever the project points it at.
 *
 * Transport only: policy, then delegation to `SecretService`. Plaintext values
 * arrive in `create`/`update` input and are never read back out — nothing here
 * logs, echoes, or copies one, and the host's audit trail redacts the field.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import {
  createSecretInputSchema,
  deleteSecretInputSchema,
  listSecretsInputSchema,
  secretIdSchema,
  secretProjectIdSchema,
  secretValueSchema,
} from "@langwatch/secret-contract";
import { z } from "zod";
import type { SecretApp } from "#app/secret.app";

/**
 * The host supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the host's application this feature reaches, not the
 * feature's application itself, because a tRPC root is shared by every feature
 * mounted on it and so carries all of them. The REST door, whose service is
 * built per family, holds {@link SecretApp} directly. Both reach the same
 * object; only the path to it differs, and closing that gap means a middleware
 * that narrows the context per router.
 */
export type SecretTrpcContext = Readonly<{
  app: Readonly<{ secrets: SecretApp }>;
  actor(): Readonly<{ id: string }>;
  /**
   * The project-scoped authorization a host performs when it injects no
   * `policy` of its own. Still required, because that fallback is what keeps a
   * host without a declared-permission pipeline authorized.
   */
  authorize(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<void>;
}>;

/**
 * The host's policy for one declared permission.
 *
 * Applied by this feature AFTER its own input parser rather than composed
 * ahead of it, because the authorization check reads its scope id from the
 * validated input: tRPC runs middlewares in the order they were added, so a
 * check installed before `.input()` would see no input at all.
 */
export type SecretTrpcPolicy = (
  permission: AuthzPermission,
) => <TProcedure>(procedure: TProcedure) => TProcedure;

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies a middleware to a builder whose input generics belong to
 * the caller, so the fallback policy below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

type PolicyMiddlewareOptions = Readonly<{
  ctx: SecretTrpcContext;
  input: Readonly<{ projectId: string }>;
  next(): Promise<unknown>;
}>;

/**
 * The policy for a host that injects none: exactly the project-scoped
 * `ctx.authorize` the handlers used to run inline, lifted to a middleware so
 * every host authorizes at the same point in the chain and no handler carries
 * an authorization branch of its own.
 */
const contextAuthorizePolicy: SecretTrpcPolicy =
  (permission) =>
  <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure).use(
      async ({ ctx, input, next }: PolicyMiddlewareOptions) => {
        await ctx.authorize(permission, { projectId: input.projectId });
        return next();
      },
    ) as unknown as TProcedure;

type SecretTrpcProcedures<
  TContext extends SecretTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The host's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The host's tracing, logging, error, scope-lineage, authorization and audit
   * policy for one declared permission. A host that omits it authorizes
   * through `ctx.authorize` instead.
   */
  policy?: SecretTrpcPolicy;
}>;

const legacyUpdateInputSchema = z
  .object({ projectId: secretProjectIdSchema, secretId: secretIdSchema, value: secretValueSchema })
  .strict();
const legacyDeleteInputSchema = deleteSecretInputSchema
  .omit({ id: true })
  .extend({ secretId: secretIdSchema });

/** Installs Secret on the host-owned tRPC root and its policy procedures. */
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
    const { protected: procedure, policy = contextAuthorizePolicy } = procedures;

    return trpc.router({
      list: policy("secrets:view")(procedure.input(listSecretsInputSchema)).query(
        async ({ ctx, input }) => {
          ctx.actor();
          return ctx.app.secrets.list(input);
        },
      ),
      create: policy("secrets:manage")(
        procedure.input(createSecretInputSchema.omit({ actorId: true })),
      ).mutation(async ({ ctx, input }) => ctx.app.secrets.create(input, ctx.actor())),
      update: policy("secrets:manage")(procedure.input(legacyUpdateInputSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.secrets.update(
            { projectId: input.projectId, id: input.secretId, value: input.value },
            ctx.actor(),
          );
          return { success: true };
        },
      ),
      delete: policy("secrets:manage")(procedure.input(legacyDeleteInputSchema)).mutation(
        async ({ ctx, input }) => {
          ctx.actor();
          await ctx.app.secrets.delete({ projectId: input.projectId, id: input.secretId });
          return { success: true };
        },
      ),
    });
  }
}

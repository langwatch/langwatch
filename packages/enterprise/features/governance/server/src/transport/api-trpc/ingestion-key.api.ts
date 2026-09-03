/**
 * Ingestion-keys tRPC surface — the user-side mint/rotate/list flow for
 * personal-project trace ingest.
 *
 * An ingestion key is one row of the single ApiKey primitive (`ik-lw-`)
 * carrying a non-null `ingestSourceType`. `organizationId` is in the input
 * because a user can have a personal project per organization they are a
 * member of, and the caller's currently-active org disambiguates which one to
 * mint into. `organization:view` is the membership check that gate every
 * governance surface shares — the actual reach is the caller's userId, from
 * `ctx.actor()`, never from input.
 *
 * Mint and rotate share one service call: the governance service rotates in
 * place (revokes any prior live key for the (project, sourceType) pair before
 * issuing the new one), so a tool never accumulates keys.
 *
 * Transport only: input parsing, delegation, wire shape. The persistence and
 * the rotation invariant belong to {@link GovernanceService}.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

export type IngestionKeyTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type IngestionKeyTrpcProcedures<
  TContext extends IngestionKeyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): ProcedureDecorator;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });

const mintSchema = organizationScopeSchema.extend({
  sourceType: z.string().min(1),
  templateId: z.string().min(1).optional(),
});

/** Installs the `ingestionKey.*` tRPC surface on a process root. */
export class IngestionKeyTrpcApi {
  static create<
    TContext extends IngestionKeyTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: IngestionKeyTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * The caller's live ingestion keys within the active org — powers the
       * "Trace Ingest" grid's "is this source connected" tile state so a green
       * check survives a reload.
       */
      list: policy("organization:view")(procedure.input(organizationScopeSchema)).query(
        async ({ ctx, input }) =>
          ctx.app.governance.ingestionKeyListForPersonalProject({
            userId: ctx.actor().id,
            organizationId: input.organizationId,
          }),
      ),

      /**
       * Mint (rotating in place) an ingestion key for the caller's personal
       * project + sourceType. Returns the plaintext token once; subsequent
       * reads only see the source list.
       */
      install: policy("organization:view")(procedure.input(mintSchema)).mutation(
        async ({ ctx, input }) =>
          ctx.app.governance.ingestionKeyEnsureForPersonalProject({
            userId: ctx.actor().id,
            organizationId: input.organizationId,
            sourceType: input.sourceType,
            ingestionTemplateId: input.templateId ?? null,
          }),
      ),

      /**
       * Hard-cut rotation: re-mint the key for (personal project, sourceType).
       * The previous token is revoked immediately, so any tool still using it
       * starts failing auth on its next request.
       */
      rotate: policy("organization:view")(procedure.input(mintSchema)).mutation(
        async ({ ctx, input }) =>
          ctx.app.governance.ingestionKeyEnsureForPersonalProject({
            userId: ctx.actor().id,
            organizationId: input.organizationId,
            sourceType: input.sourceType,
            ingestionTemplateId: input.templateId ?? null,
          }),
      ),
    });
  }
}

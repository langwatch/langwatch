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
 * the rotation invariant belong to {@link GovernanceApi}.
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  issuedIngestionKeySchema,
  personalIngestionKeySchema,
  type GovernanceApi,
} from "@langwatch/enterprise-governance-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

export type IngestionKeyTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceApi }>;
  actor(): Readonly<{ id: string }>;
}>;

type IngestionKeyTrpcProcedures<
  TContext extends IngestionKeyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
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
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("list", (p) =>
        p
          .withInput(organizationScopeSchema)
          .withOutput(personalIngestionKeySchema.array())
          .withPermission("organization:view")
          /**
           * The caller's live ingestion keys within the active organization —
           * what the "Trace Ingest" grid reads to decide whether a source is
           * connected, so a green check survives a reload.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.ingestionKeyListForPersonalProject({
              userId: ctx.actor().id,
              organizationId: input.organizationId,
            }),
          ),
      )
      .mutation("install", (p) =>
        p
          .withInput(mintSchema)
          .withOutput(issuedIngestionKeySchema)
          .withPermission("organization:view")
          /**
           * Mints — rotating in place — an ingestion key for the caller's
           * personal project and source type. Answers the plaintext token once;
           * every later read sees the source list and nothing more.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.ingestionKeyEnsureForPersonalProject({
              userId: ctx.actor().id,
              organizationId: input.organizationId,
              sourceType: input.sourceType,
              ingestionTemplateId: input.templateId ?? null,
            }),
          ),
      )
      .mutation("rotate", (p) =>
        p
          .withInput(mintSchema)
          .withOutput(issuedIngestionKeySchema)
          .withPermission("organization:view")
          /**
           * Hard-cut rotation: re-mints the key for this personal project and
           * source type. The previous token is revoked immediately, so a tool
           * still holding it starts failing on its next request.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.ingestionKeyEnsureForPersonalProject({
              userId: ctx.actor().id,
              organizationId: input.organizationId,
              sourceType: input.sourceType,
              ingestionTemplateId: input.templateId ?? null,
            }),
          ),
      )
      .build();
  }
}

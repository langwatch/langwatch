/**
 * The personal workspace's progressive feature unlock, over tRPC. Authorized by the caller being
 * the project's `ownerUserId` (proved by the service), not an organization permission — the
 * bundle is a UI/nav predicate, so disabling hides nav but never deletes data.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzDeclaration } from "@langwatch/authz-contract";
import {
  PersonalProjectNotFoundError,
  PersonalProjectOwnerMismatchError,
  personalFeaturesSchema,
} from "@langwatch/organization-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { OrganizationApp } from "#app/organization.app";

/**
 * The process supplies authentication; authorization arrives as `policy`. `app` is the slice of
 * the process's application this feature reaches, since a shared tRPC root carries every feature.
 */
export type PersonalWorkspaceFeaturesTrpcContext = Readonly<{
  app: Readonly<{ organizations: OrganizationApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type PersonalWorkspaceFeaturesTrpcProcedures<
  TContext extends PersonalWorkspaceFeaturesTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** The process's tracing/logging/error/authorization/audit policy for one access declaration.
   * Applied after this feature's own input parser, since the check reads its scope id from it. */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

const OWNED_BY_ITS_OWNER: AuthzDeclaration = {
  kind: "no-permission",
  reason: "a personal workspace belongs to its owner, not a team",
  allow: {
    projectId:
      "auth is service-layer (PersonalWorkspaceFeaturesService asserts isPersonal && ownerUserId === caller)",
  },
};

const projectScopeSchema = z.object({ projectId: z.string() });

/**
 * The service's two refusals are both "this is not your personal project", and
 * both answer NOT_FOUND: telling the caller which of the two it was would
 * confirm the existence of somebody else's workspace.
 */
function asNotFound(err: unknown): never {
  if (
    err instanceof PersonalProjectNotFoundError ||
    err instanceof PersonalProjectOwnerMismatchError
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  throw err;
}

/** Installs the complete `personalWorkspaceFeatures.*` surface on a process root. */
export class PersonalWorkspaceFeaturesTrpcApi {
  static create<
    TContext extends PersonalWorkspaceFeaturesTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: PersonalWorkspaceFeaturesTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("get", (p) =>
        p
          .withInput(projectScopeSchema)
          .withOutput(personalFeaturesSchema)
          .withPermission(OWNED_BY_ITS_OWNER)
          .handle(async ({ ctx, input }) => {
            try {
              return await ctx.app.organizations.getPersonalWorkspaceFeatures(
                { projectId: input.projectId },
                ctx.actor(),
              );
            } catch (err) {
              return asNotFound(err);
            }
          }),
      )
      .mutation("enableAll", (p) =>
        p
          .withInput(projectScopeSchema)
          .withOutput(personalFeaturesSchema)
          .withPermission(OWNED_BY_ITS_OWNER)
          .handle(async ({ ctx, input }) => {
            try {
              return await ctx.app.organizations.enableAllPersonalWorkspaceFeatures(
                { projectId: input.projectId },
                ctx.actor(),
              );
            } catch (err) {
              return asNotFound(err);
            }
          }),
      )
      .mutation("disableAll", (p) =>
        p
          .withInput(projectScopeSchema)
          .withOutput(personalFeaturesSchema)
          .withPermission(OWNED_BY_ITS_OWNER)
          .handle(async ({ ctx, input }) => {
            try {
              return await ctx.app.organizations.disableAllPersonalWorkspaceFeatures(
                { projectId: input.projectId },
                ctx.actor(),
              );
            } catch (err) {
              return asNotFound(err);
            }
          }),
      )
      .build();
  }
}

/**
 * The personal workspace's progressive feature unlock, over the process's tRPC
 * transport.
 *
 * Distinct from every project-level RBAC surface: these procedures are
 * authorized solely by the caller being the `ownerUserId` of the personal
 * project, so no organization permission is required — the personal project IS
 * the caller's by construction. The service proves that (`isPersonal &&
 * ownerUserId === caller`), which is why the declaration is an explicit,
 * reviewable opt-out naming the one scope id it lets through.
 *
 * The bundle is a UI/nav predicate, NOT an auth gate: the underlying surfaces
 * (`datasets.*`, `evaluations.*`, …) stay open even when the bundle is off.
 * Disabling hides nav, never deletes data.
 *
 * Transport only: gate, input parsing and delegation to `OrganizationService`.
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-features.feature.
 */
import type { AuthzDeclaration } from "@langwatch/authz-contract";
import {
  PersonalProjectNotFoundError,
  PersonalProjectOwnerMismatchError,
} from "@langwatch/organization-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { OrganizationApp } from "#app/organization.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. Before
 * {@link OrganizationApp} this door declared its own three-method narrowing of
 * `OrganizationService`, which is the fourth private description of one
 * composition inside this feature.
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
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one access declaration.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the check reads its scope id from the validated
   * input: tRPC runs middlewares in the order they were added, so a check
   * installed before `.input()` would see no input at all.
   */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
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
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      get: policy(OWNED_BY_ITS_OWNER)(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) => {
          try {
            return await ctx.app.organizations.getPersonalWorkspaceFeatures(
              { projectId: input.projectId },
              ctx.actor(),
            );
          } catch (err) {
            return asNotFound(err);
          }
        },
      ),

      enableAll: policy(OWNED_BY_ITS_OWNER)(procedure.input(projectScopeSchema)).mutation(
        async ({ ctx, input }) => {
          try {
            return await ctx.app.organizations.enableAllPersonalWorkspaceFeatures(
              { projectId: input.projectId },
              ctx.actor(),
            );
          } catch (err) {
            return asNotFound(err);
          }
        },
      ),

      disableAll: policy(OWNED_BY_ITS_OWNER)(procedure.input(projectScopeSchema)).mutation(
        async ({ ctx, input }) => {
          try {
            return await ctx.app.organizations.disableAllPersonalWorkspaceFeatures(
              { projectId: input.projectId },
              ctx.actor(),
            );
          } catch (err) {
            return asNotFound(err);
          }
        },
      ),
    });
  }
}

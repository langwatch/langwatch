/**
 * Departments tRPC surface — org-scoped CRUD plus assignment of users, teams
 * and projects to a department. Reads gate on `governance:view`, writes on
 * `governance:manage`. Pure accounting; a department is never an access gate.
 *
 * The old app-side transport translated two error classes to `NOT_FOUND` by
 * hand. Both are now `HandledError` subclasses with `httpStatus: 404`, so the
 * tRPC error formatter serialises them on the wire without the router
 * knowing — the transport reads as three lines per procedure, all delegation.
 *
 * Spec: specs/ai-gateway/governance/departments.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

export type DepartmentsTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type DepartmentsTrpcProcedures<
  TContext extends DepartmentsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): ProcedureDecorator;
}>;

const organizationScope = z.object({ organizationId: z.string() });
const departmentName = z.string().min(1).max(128);
const idAndOrg = organizationScope.extend({ id: z.string() });

const renameSchema = idAndOrg.extend({ name: departmentName });
const createSchema = organizationScope.extend({ name: departmentName });
const assignUserSchema = organizationScope.extend({
  userId: z.string(),
  departmentId: z.string().nullable(),
});
const assignTeamSchema = organizationScope.extend({
  teamId: z.string(),
  departmentId: z.string().nullable(),
});
const assignProjectSchema = organizationScope.extend({
  projectId: z.string(),
  departmentId: z.string().nullable(),
});

/** Installs the `departments.*` tRPC surface on a process root. */
export class DepartmentsTrpcApi {
  static create<
    TContext extends DepartmentsTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: DepartmentsTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      list: policy("governance:view")(procedure.input(organizationScope)).query(
        async ({ ctx, input }) => ctx.app.governance.departmentList(input.organizationId),
      ),

      assignments: policy("governance:view")(procedure.input(organizationScope)).query(
        async ({ ctx, input }) =>
          ctx.app.governance.departmentAssignments(input.organizationId),
      ),

      create: policy("governance:manage")(procedure.input(createSchema)).mutation(
        async ({ ctx, input }) => ctx.app.governance.departmentCreate(input),
      ),

      rename: policy("governance:manage")(procedure.input(renameSchema)).mutation(
        async ({ ctx, input }) =>
          ctx.app.governance.departmentRename({
            id: input.id,
            organizationId: input.organizationId,
            name: input.name,
          }),
      ),

      archive: policy("governance:manage")(procedure.input(idAndOrg)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.governance.departmentArchive({
            id: input.id,
            organizationId: input.organizationId,
          });
          return { ok: true };
        },
      ),

      assignUser: policy("governance:manage")(procedure.input(assignUserSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.governance.departmentAssignUser(input);
          return { ok: true };
        },
      ),

      assignTeam: policy("governance:manage")(procedure.input(assignTeamSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.governance.departmentAssignTeam(input);
          return { ok: true };
        },
      ),

      assignProject: policy("governance:manage")(
        procedure.input(assignProjectSchema),
      ).mutation(async ({ ctx, input }) => {
        await ctx.app.governance.departmentAssignProject(input);
        return { ok: true };
      }),
    });
  }
}

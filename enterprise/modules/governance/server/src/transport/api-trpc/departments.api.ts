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
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  departmentAssignmentsSchema,
  departmentSchema,
  governanceWriteAcknowledgedSchema,
  type GovernanceApi,
} from "@langwatch/enterprise-governance-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

export type DepartmentsTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceApi }>;
}>;

type DepartmentsTrpcProcedures<
  TContext extends DepartmentsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
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
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("list", (p) =>
        p
          .withInput(organizationScope)
          .withOutput(departmentSchema.array())
          .withPermission("governance:view")
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.departmentList(input.organizationId),
          ),
      )
      .query("assignments", (p) =>
        p
          .withInput(organizationScope)
          .withOutput(departmentAssignmentsSchema)
          .withPermission("governance:view")
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.departmentAssignments(input.organizationId),
          ),
      )
      .mutation("create", (p) =>
        p
          .withInput(createSchema)
          .withOutput(departmentSchema)
          .withPermission("governance:manage")
          .handle(async ({ ctx, input }) => ctx.app.governance.departmentCreate(input)),
      )
      .mutation("rename", (p) =>
        p
          .withInput(renameSchema)
          .withOutput(departmentSchema)
          .withPermission("governance:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.departmentRename({
              id: input.id,
              organizationId: input.organizationId,
              name: input.name,
            }),
          ),
      )
      .mutation("archive", (p) =>
        p
          .withInput(idAndOrg)
          .withOutput(governanceWriteAcknowledgedSchema)
          .withPermission("governance:manage")
          .handle(async ({ ctx, input }) => {
            await ctx.app.governance.departmentArchive({
              id: input.id,
              organizationId: input.organizationId,
            });
            return { ok: true };
          }),
      )
      .mutation("assignUser", (p) =>
        p
          .withInput(assignUserSchema)
          .withOutput(governanceWriteAcknowledgedSchema)
          .withPermission("governance:manage")
          .handle(async ({ ctx, input }) => {
            await ctx.app.governance.departmentAssignUser(input);
            return { ok: true };
          }),
      )
      .mutation("assignTeam", (p) =>
        p
          .withInput(assignTeamSchema)
          .withOutput(governanceWriteAcknowledgedSchema)
          .withPermission("governance:manage")
          .handle(async ({ ctx, input }) => {
            await ctx.app.governance.departmentAssignTeam(input);
            return { ok: true };
          }),
      )
      .mutation("assignProject", (p) =>
        p
          .withInput(assignProjectSchema)
          .withOutput(governanceWriteAcknowledgedSchema)
          .withPermission("governance:manage")
          .handle(async ({ ctx, input }) => {
            await ctx.app.governance.departmentAssignProject(input);
            return { ok: true };
          }),
      )
      .build();
  }
}

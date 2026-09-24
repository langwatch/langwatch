// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `departments.*`: reads take `governance:view`, writes
 * `governance:manage`, as on main. A department is accounting, never an access gate.
 * @see specs/ai-gateway/governance/departments.feature
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, departmentsTrpc } from "@langwatch/enterprise-governance-contract";

export const departmentsTrpcTransport = defineTrpcRouter(GovernanceRestApi, departmentsTrpc)
  .procedure("list")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.departmentList({ organizationId: input.organizationId }))

  .procedure("assignments")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.departmentAssignments({ organizationId: input.organizationId }))

  .procedure("create")
  .withPermission("governance:manage")
  .handle(({ app, input }) => app.departmentCreate(input))

  .procedure("rename")
  .withPermission("governance:manage")
  .handle(({ app, input }) => app.departmentRename(input))

  .procedure("archive")
  .withPermission("governance:manage")
  .handle(async ({ app, input }) => {
    await app.departmentArchive(input);
    return { ok: true };
  })

  .procedure("assignUser")
  .withPermission("governance:manage")
  .handle(async ({ app, input }) => {
    await app.departmentAssignUser(input);
    return { ok: true };
  })

  .procedure("assignTeam")
  .withPermission("governance:manage")
  .handle(async ({ app, input }) => {
    await app.departmentAssignTeam(input);
    return { ok: true };
  })

  .procedure("assignProject")
  .withPermission("governance:manage")
  .handle(async ({ app, input }) => {
    await app.departmentAssignProject(input);
    return { ok: true };
  })
  .build();

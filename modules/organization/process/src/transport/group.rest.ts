/**
 * `/api/groups` - the organization's access groups, behind an organization
 * credential, clearing the Enterprise plan gate SCIM groups require; writes
 * attribute to the grants ledger as the credential's own member.
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import {
  OrganizationApi,
  organizationGroupBindingInputSchema,
  organizationGroupRestAddMemberSchema,
  organizationGroupRestBindingListSchema,
  organizationGroupRestBindingParamsSchema,
  organizationGroupRestBindingSchema,
  organizationGroupRestCreateSchema,
  organizationGroupRestCreatedSchema,
  organizationGroupRestDetailsSchema,
  organizationGroupRestListQuerySchema,
  organizationGroupRestMemberListSchema,
  organizationGroupRestMemberParamsSchema,
  organizationGroupRestPageSchema,
  organizationGroupRestParamsSchema,
  organizationGroupRestRenameSchema,
  organizationGroupRestRenamedSchema,
  organizationRestSuccessSchema,
  type OrganizationCaller,
  type OrganizationGroupBinding,
  type OrganizationGroupMember,
} from "@langwatch/organization-contract";
import { z } from "zod";

/**
 * Whether the credential's organization holds the Enterprise plan groups
 * require, resolved after authentication and after the permission check —
 * the ordering the pre-conversion per-route gate held.
 */
export const groupsRestEnterpriseGate = defineRestMiddleware(
  "groupsRestEnterpriseGate",
  z.object({}),
);

/**
 * Who a write is attributed to in the grants ledger (ADR-092): the member the
 * credential acts as, or the management API itself for a service key, which
 * acts as nobody.
 */
const callerOf = (actor: { type: string; id?: string } | null): OrganizationCaller =>
  actor && actor.type === "user" && actor.id
    ? { id: actor.id }
    : { id: SYSTEM_ACTORS.managementApi };

/** One binding, as every route that reports one answers it. */
const bindingWire = (binding: OrganizationGroupBinding) => ({
  id: binding.id,
  role: binding.role,
  customRoleId: binding.customRoleId,
  customRoleName: binding.customRoleName,
  scopeType: binding.scopeType,
  scopeId: binding.scopeId,
});

/** One member, without the avatar this door does not publish. */
const memberWire = (member: OrganizationGroupMember) => ({
  userId: member.userId,
  name: member.name,
  email: member.email,
});

export const groupsRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<OrganizationApi>;
}> = defineRestRouter(OrganizationApi)
  .withNamespace("groups")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")

  .get("/", "getApiGroups")
  .withPermission("organization:manage")
  .withQuery(organizationGroupRestListQuerySchema)
  .withOutput(organizationGroupRestPageSchema)
  .withDocs({ tags: ["Groups"], description: "List all groups for the organization" })
  .withMiddleware(groupsRestEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    const result = await app.listGroups({
      organizationId: scope.id,
      page: input.page,
      limit: input.limit,
    });

    return {
      data: result.data.map((group) => ({
        id: group.id,
        name: group.name,
        slug: group.slug,
        externalId: group.externalId,
        scimSource: group.scimSource,
        memberCount: group.memberCount,
        bindings: group.bindings.map(bindingWire),
        createdAt: group.createdAt,
      })),
      pagination: result.pagination,
    };
  })

  .post("/", "postApiGroups")
  .withPermission("organization:manage")
  .withInput(organizationGroupRestCreateSchema)
  .withOutput(organizationGroupRestCreatedSchema)
  .withStatus(201)
  .withDocs({ tags: ["Groups"], description: "Create a new group" })
  .withMiddleware(groupsRestEnterpriseGate)
  .handle(async ({ app, input, scope, actor }) => {
    const group = await app.createGroup(
      {
        organizationId: scope.id,
        name: input.name,
        ...(input.bindings ? { bindings: input.bindings } : {}),
        ...(input.memberIds ? { memberIds: input.memberIds } : {}),
      },
      callerOf(actor),
    );

    return {
      id: group.id,
      name: group.name,
      slug: group.slug,
      organizationId: group.organizationId,
      createdAt: group.createdAt,
    };
  })

  .get("/:groupId", "getApiGroupsById")
  .withPermission("organization:manage")
  .withParams(organizationGroupRestParamsSchema)
  .withOutput(organizationGroupRestDetailsSchema)
  .withDocs({ tags: ["Groups"], description: "Get a group with members and bindings" })
  .withMiddleware(groupsRestEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    const group = await app.getGroup({ groupId: input.groupId, organizationId: scope.id });

    return {
      id: group.id,
      name: group.name,
      slug: group.slug,
      externalId: group.externalId,
      scimSource: group.scimSource,
      members: group.members.map(memberWire),
      bindings: group.bindings.map(bindingWire),
    };
  })

  .patch("/:groupId", "patchApiGroupsById")
  .withPermission("organization:manage")
  .withParams(organizationGroupRestParamsSchema)
  .withInput(organizationGroupRestRenameSchema)
  .withOutput(organizationGroupRestRenamedSchema)
  .withDocs({ tags: ["Groups"], description: "Rename a group" })
  .withMiddleware(groupsRestEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    const group = await app.renameGroup({
      groupId: input.groupId,
      organizationId: scope.id,
      name: input.name,
    });

    return { id: group.id, name: group.name, slug: group.slug };
  })

  .delete("/:groupId", "deleteApiGroupsById")
  .withPermission("organization:manage")
  .withParams(organizationGroupRestParamsSchema)
  .withOutput(organizationRestSuccessSchema)
  .withDocs({ tags: ["Groups"], description: "Delete a group" })
  .withMiddleware(groupsRestEnterpriseGate)
  .handle(async ({ app, input, scope, actor }) => {
    await app.deleteGroup({ groupId: input.groupId, organizationId: scope.id }, callerOf(actor));

    return { success: true };
  })

  .get("/:groupId/members", "getApiGroupsByIdMembers")
  .withPermission("organization:manage")
  .withParams(organizationGroupRestParamsSchema)
  .withOutput(organizationGroupRestMemberListSchema)
  .withDocs({ tags: ["Groups"], description: "List members of a group" })
  .withMiddleware(groupsRestEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    const group = await app.getGroup({ groupId: input.groupId, organizationId: scope.id });

    return { data: group.members.map(memberWire) };
  })

  .post("/:groupId/members", "postApiGroupsByIdMembers")
  .withPermission("organization:manage")
  .withParams(organizationGroupRestParamsSchema)
  .withInput(organizationGroupRestAddMemberSchema)
  .withOutput(organizationRestSuccessSchema)
  .withStatus(201)
  .withDocs({ tags: ["Groups"], description: "Add a member to a group" })
  .withMiddleware(groupsRestEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    await app.addGroupMember({
      groupId: input.groupId,
      organizationId: scope.id,
      userId: input.userId,
    });

    return { success: true };
  })

  .delete("/:groupId/members/:userId", "deleteApiGroupsByIdMembersByUserId")
  .withPermission("organization:manage")
  .withParams(organizationGroupRestMemberParamsSchema)
  .withOutput(organizationRestSuccessSchema)
  .withDocs({ tags: ["Groups"], description: "Remove a member from a group" })
  .withMiddleware(groupsRestEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    await app.removeGroupMember({
      groupId: input.groupId,
      organizationId: scope.id,
      userId: input.userId,
    });

    return { success: true };
  })

  .get("/:groupId/bindings", "getApiGroupsByIdBindings")
  .withPermission("organization:manage")
  .withParams(organizationGroupRestParamsSchema)
  .withOutput(organizationGroupRestBindingListSchema)
  .withDocs({ tags: ["Groups"], description: "List role bindings for a group" })
  .withMiddleware(groupsRestEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    const bindings = await app.listGroupBindings({
      organizationId: scope.id,
      groupId: input.groupId,
    });

    return { data: bindings.map(bindingWire) };
  })

  .post("/:groupId/bindings", "postApiGroupsByIdBindings")
  .withPermission("organization:manage")
  .withParams(organizationGroupRestParamsSchema)
  .withInput(organizationGroupBindingInputSchema)
  .withOutput(organizationGroupRestBindingSchema)
  .withStatus(201)
  .withDocs({ tags: ["Groups"], description: "Add a role binding to a group" })
  .withMiddleware(groupsRestEnterpriseGate)
  .handle(async ({ app, input, scope, actor }) => {
    const { groupId: id, ...binding } = input;
    const created = await app.addGroupBinding(
      { groupId: id, organizationId: scope.id, binding },
      callerOf(actor),
    );

    return {
      id: created.id,
      role: created.role,
      scopeType: created.scopeType,
      scopeId: created.scopeId,
    };
  })

  .delete("/:groupId/bindings/:bindingId", "deleteApiGroupsByIdBindingsByBindingId")
  .withPermission("organization:manage")
  .withParams(organizationGroupRestBindingParamsSchema)
  .withOutput(organizationRestSuccessSchema)
  .withDocs({ tags: ["Groups"], description: "Remove a role binding from a group" })
  .withMiddleware(groupsRestEnterpriseGate)
  .handle(async ({ app, input, scope, actor }) => {
    await app.removeGroupBinding(
      { groupId: input.groupId, bindingId: input.bindingId, organizationId: scope.id },
      callerOf(actor),
    );

    return { success: true };
  })

  .build();

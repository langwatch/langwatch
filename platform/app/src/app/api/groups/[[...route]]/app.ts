import {
  type Organization,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { createOrgApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import {
  BindingNotFoundError,
  GroupNotFoundError,
} from "~/server/app-layer/groups/errors";
import type { GroupRestService } from "~/server/app-layer/groups/group.service";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { requireEnterprisePlanRest } from "../../middleware/enterprise-gate";
import type { GroupServiceMiddlewareVariables } from "../../middleware/group-service";
import { groupServiceMiddleware } from "../../middleware/group-service";
import { handleGroupError } from "./error-handler";

patchZodOpenapi();

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const createGroupSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100),
  bindings: z
    .array(
      z.object({
        role: z.nativeEnum(TeamUserRole),
        customRoleId: z.string().optional(),
        scopeType: z.nativeEnum(RoleBindingScopeType),
        scopeId: z.string().min(1, "scopeId is required"),
      }),
    )
    .optional(),
  memberIds: z.array(z.string()).optional(),
});

const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const addMemberSchema = z.object({
  userId: z.string().min(1, "userId is required"),
});

const addBindingSchema = z.object({
  role: z.nativeEnum(TeamUserRole),
  customRoleId: z.string().optional(),
  scopeType: z.nativeEnum(RoleBindingScopeType),
  scopeId: z.string().min(1, "scopeId is required"),
});

const secured = createOrgApp<GroupServiceMiddlewareVariables>({
  basePath: "/api/groups",
});

secured.hono.onError(handleGroupError);

/**
 * Groups are an Enterprise capability, so every route carries this gate.
 * Per-route and after the `.access(...)` chain on purpose: the gate reads the
 * organization that org auth resolved onto the context, so an app-level
 * `.use` would run before authentication and find nothing, and the RBAC
 * denial should fire before the plan denial anyway.
 */
const enterpriseGate = requireEnterprisePlanRest("GROUPS");

// ── List groups ──────────────────────────────────────────────────────────────

secured
  .access(requires("organization:manage"))
  .get(
    "/",
    enterpriseGate,
    groupServiceMiddleware,
    describeRoute({ description: "List all groups for the organization" }),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const { page, limit } = c.req.valid("query");
      const service = c.get("groupService") as GroupRestService;

      const result = await service.listByOrganization({
        organizationId: organization.id,
        page,
        limit,
      });

      return c.json({
        data: result.data.map((g) => ({
          id: g.id,
          name: g.name,
          slug: g.slug,
          externalId: g.externalId,
          scimSource: g.scimSource,
          memberCount: g._count.members,
          bindings: g.roleBindings.map((b) => ({
            id: b.id,
            role: b.role,
            customRoleId: b.customRoleId,
            customRoleName: b.customRole?.name ?? null,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          })),
          createdAt: g.createdAt,
        })),
        pagination: result.pagination,
      });
    },
  );

// ── Create group ─────────────────────────────────────────────────────────────

secured
  .access(requires("organization:manage"))
  .post(
    "/",
    enterpriseGate,
    groupServiceMiddleware,
    describeRoute({ description: "Create a new group" }),
    zValidator("json", createGroupSchema),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");
      const service = c.get("groupService") as GroupRestService;

      const group = await service.create({
        organizationId: organization.id,
        name: body.name,
        bindings: body.bindings,
        memberIds: body.memberIds,
      });

      return c.json(
        {
          id: group.id,
          name: group.name,
          slug: group.slug,
          organizationId: group.organizationId,
          createdAt: group.createdAt,
        },
        201,
      );
    },
  );

// ── Get group ────────────────────────────────────────────────────────────────

secured
  .access(requires("organization:manage"))
  .get(
    "/:id",
    enterpriseGate,
    groupServiceMiddleware,
    describeRoute({ description: "Get a group with members and bindings" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("groupService") as GroupRestService;

      const group = await service.getById({
        id,
        organizationId: organization.id,
      });
      if (!group) throw new GroupNotFoundError(id);

      return c.json({
        id: group.id,
        name: group.name,
        slug: group.slug,
        externalId: group.externalId,
        scimSource: group.scimSource,
        members: group.members.map((m) => ({
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
        })),
        bindings: group.roleBindings.map((b) => ({
          id: b.id,
          role: b.role,
          customRoleId: b.customRoleId,
          customRoleName: b.customRole?.name ?? null,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        })),
      });
    },
  );

// ── Update group (rename) ────────────────────────────────────────────────────

secured
  .access(requires("organization:manage"))
  .patch(
    "/:id",
    enterpriseGate,
    groupServiceMiddleware,
    describeRoute({ description: "Rename a group" }),
    zValidator("json", updateGroupSchema),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");
      const service = c.get("groupService") as GroupRestService;

      const group = await service.rename({
        id,
        organizationId: organization.id,
        name: body.name,
      });
      return c.json({
        id: group.id,
        name: group.name,
        slug: group.slug,
      });
    },
  );

// ── Delete group ─────────────────────────────────────────────────────────────

secured
  .access(requires("organization:manage"))
  .delete(
    "/:id",
    enterpriseGate,
    groupServiceMiddleware,
    describeRoute({ description: "Delete a group" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("groupService") as GroupRestService;

      await service.delete({ id, organizationId: organization.id });

      return c.json({ success: true });
    },
  );

// ── Members ──────────────────────────────────────────────────────────────────

secured
  .access(requires("organization:manage"))
  .get(
    "/:id/members",
    enterpriseGate,
    groupServiceMiddleware,
    describeRoute({ description: "List members of a group" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("groupService") as GroupRestService;

      const group = await service.getById({
        id,
        organizationId: organization.id,
      });
      if (!group) throw new GroupNotFoundError(id);

      const members = await service.getMembers({ groupId: id });
      return c.json({
        data: members.map((m) => ({
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
        })),
      });
    },
  );

secured
  .access(requires("organization:manage"))
  .post(
    "/:id/members",
    enterpriseGate,
    groupServiceMiddleware,
    describeRoute({ description: "Add a member to a group" }),
    zValidator("json", addMemberSchema),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");
      const service = c.get("groupService") as GroupRestService;

      await service.addMember({
        groupId: id,
        organizationId: organization.id,
        userId: body.userId,
      });

      return c.json({ success: true }, 201);
    },
  );

secured
  .access(requires("organization:manage"))
  .delete(
    "/:id/members/:userId",
    enterpriseGate,
    groupServiceMiddleware,
    describeRoute({ description: "Remove a member from a group" }),
    async (c) => {
      const { id, userId } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("groupService") as GroupRestService;

      await service.removeMember({
        groupId: id,
        organizationId: organization.id,
        userId,
      });

      return c.json({ success: true });
    },
  );

// ── Bindings ─────────────────────────────────────────────────────────────────

secured
  .access(requires("organization:manage"))
  .get(
    "/:id/bindings",
    enterpriseGate,
    groupServiceMiddleware,
    describeRoute({ description: "List role bindings for a group" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("groupService") as GroupRestService;

      const group = await service.getById({
        id,
        organizationId: organization.id,
      });
      if (!group) throw new GroupNotFoundError(id);

      const bindings = await service.getBindings({ groupId: id });
      return c.json({
        data: bindings.map((b) => ({
          id: b.id,
          role: b.role,
          customRoleId: b.customRoleId,
          customRoleName: b.customRole?.name ?? null,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        })),
      });
    },
  );

secured
  .access(requires("organization:manage"))
  .post(
    "/:id/bindings",
    enterpriseGate,
    groupServiceMiddleware,
    describeRoute({ description: "Add a role binding to a group" }),
    zValidator("json", addBindingSchema),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");
      const service = c.get("groupService") as GroupRestService;

      const binding = await service.addBinding({
        groupId: id,
        organizationId: organization.id,
        role: body.role,
        customRoleId: body.customRoleId,
        scopeType: body.scopeType,
        scopeId: body.scopeId,
      });
      return c.json(
        {
          id: binding.id,
          role: binding.role,
          scopeType: binding.scopeType,
          scopeId: binding.scopeId,
        },
        201,
      );
    },
  );

secured
  .access(requires("organization:manage"))
  .delete(
    "/:id/bindings/:bindingId",
    enterpriseGate,
    groupServiceMiddleware,
    describeRoute({ description: "Remove a role binding from a group" }),
    async (c) => {
      const { id, bindingId } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("groupService") as GroupRestService;

      const group = await service.getById({
        id,
        organizationId: organization.id,
      });
      if (!group) throw new GroupNotFoundError(id);

      const bindingBelongsToGroup = group.roleBindings.some(
        (b) => b.id === bindingId,
      );
      if (!bindingBelongsToGroup) {
        throw new BindingNotFoundError(bindingId);
      }

      await service.removeBinding({
        bindingId,
        organizationId: organization.id,
      });

      return c.json({ success: true });
    },
  );

export const app = secured.hono;

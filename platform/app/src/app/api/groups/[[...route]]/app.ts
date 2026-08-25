import { describeRoute } from "hono-openapi";
import { organizationGroupBindingInputSchema } from "@langwatch/organization-contract";
import { z } from "zod/v4";
import { orgRequestLedgerActor } from "~/app/api/shared/ledger-actor";
import { createOrgApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { requireEnterprisePlanRest } from "../../middleware/enterprise-gate";
import { handleGroupError } from "./error-handler";

patchZodOpenapi();

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const createGroupSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100),
  bindings: z.array(organizationGroupBindingInputSchema).optional(),
  memberIds: z.array(z.string()).optional(),
});

const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const addMemberSchema = z.object({
  userId: z.string().min(1, "userId is required"),
});

const addBindingSchema = organizationGroupBindingInputSchema;

const secured = createOrgApp({
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
    describeRoute({ description: "List all groups for the organization" }),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const organization = c.get("organization");
      const { page, limit } = c.req.valid("query");
      const service = c.var.langwatchApp.organizations;

      const result = await service.listGroups({
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
          memberCount: g.memberCount,
          bindings: g.bindings.map((b) => ({
            id: b.id,
            role: b.role,
            customRoleId: b.customRoleId,
            customRoleName: b.customRoleName,
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
    describeRoute({ description: "Create a new group" }),
    zValidator("json", createGroupSchema),
    async (c) => {
      const organization = c.get("organization");
      const body = c.req.valid("json");
      const service = c.var.langwatchApp.organizations;

      const group = await service.createGroup({
        organizationId: organization.id,
        name: body.name,
        bindings: body.bindings,
        memberIds: body.memberIds,
        actor: orgRequestLedgerActor(c),
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
    describeRoute({ description: "Get a group with members and bindings" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const service = c.var.langwatchApp.organizations;

      const group = await service.getGroup({
        groupId: id,
        organizationId: organization.id,
      });

      return c.json({
        id: group.id,
        name: group.name,
        slug: group.slug,
        externalId: group.externalId,
        scimSource: group.scimSource,
        members: group.members.map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
        })),
        bindings: group.bindings.map((b) => ({
          id: b.id,
          role: b.role,
          customRoleId: b.customRoleId,
          customRoleName: b.customRoleName,
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
    describeRoute({ description: "Rename a group" }),
    zValidator("json", updateGroupSchema),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const body = c.req.valid("json");
      const service = c.var.langwatchApp.organizations;

      const group = await service.renameGroup({
        groupId: id,
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
    describeRoute({ description: "Delete a group" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const service = c.var.langwatchApp.organizations;

      await service.deleteGroup({
        groupId: id,
        organizationId: organization.id,
        actor: orgRequestLedgerActor(c),
      });

      return c.json({ success: true });
    },
  );

// ── Members ──────────────────────────────────────────────────────────────────

secured
  .access(requires("organization:manage"))
  .get(
    "/:id/members",
    enterpriseGate,
    describeRoute({ description: "List members of a group" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const service = c.var.langwatchApp.organizations;

      const group = await service.getGroup({
        groupId: id,
        organizationId: organization.id,
      });

      return c.json({
        data: group.members.map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
        })),
      });
    },
  );

secured
  .access(requires("organization:manage"))
  .post(
    "/:id/members",
    enterpriseGate,
    describeRoute({ description: "Add a member to a group" }),
    zValidator("json", addMemberSchema),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const body = c.req.valid("json");
      const service = c.var.langwatchApp.organizations;

      await service.addGroupMember({
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
    describeRoute({ description: "Remove a member from a group" }),
    async (c) => {
      const { id, userId } = c.req.param();
      const organization = c.get("organization");
      const service = c.var.langwatchApp.organizations;

      await service.removeGroupMember({
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
    describeRoute({ description: "List role bindings for a group" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const service = c.var.langwatchApp.organizations;

      const bindings = await service.listGroupBindings({
        organizationId: organization.id,
        groupId: id,
      });
      return c.json({
        data: bindings.map((b) => ({
          id: b.id,
          role: b.role,
          customRoleId: b.customRoleId,
          customRoleName: b.customRoleName,
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
    describeRoute({ description: "Add a role binding to a group" }),
    zValidator("json", addBindingSchema),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const body = c.req.valid("json");
      const service = c.var.langwatchApp.organizations;

      const binding = await service.addGroupBinding({
        groupId: id,
        organizationId: organization.id,
        binding: body,
        actor: orgRequestLedgerActor(c),
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
    describeRoute({ description: "Remove a role binding from a group" }),
    async (c) => {
      const { id, bindingId } = c.req.param();
      const organization = c.get("organization");
      const service = c.var.langwatchApp.organizations;

      await service.removeGroupBinding({
        groupId: id,
        bindingId,
        organizationId: organization.id,
        actor: orgRequestLedgerActor(c),
      });

      return c.json({ success: true });
    },
  );

export const app = secured.hono;

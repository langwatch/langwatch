/**
 * The organization-scoped `/api/groups` REST family.
 *
 * The organization capability arrives as a provider rather than being read off
 * the request, so this family can be mounted into any process that has one.
 *
 * Two things the family needs are the process's, not this package's, and
 * arrive as ports: the Enterprise plan gate (it reads the deployment's billing
 * store and answers with the application's own 402) and the grants-ledger
 * attribution rule for a REST write.
 *
 * Spec: specs/groups/groups-rest-api.feature,
 *       specs/licensing/management-apis-enterprise-gate.feature
 */
import {
  organizationGroupBindingInputSchema,
  type OrganizationLedgerActor,
  type OrganizationService,
} from "@langwatch/organization-contract";
import type { Context, MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  type AppRestOrganizationVariables,
  type AppRestSecurity,
  createFamilyErrorHandler,
  patchZodOpenapi,
  requires,
  type SecuredApp,
  validator as zValidator,
} from "../../app-rest";

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

/**
 * The `/api/groups` family, built against one process's security.
 *
 * `enterpriseGate` is applied per route and after the `.access(...)` chain on
 * purpose: the gate reads the organization that org auth resolved onto the
 * context, so an app-level `.use` would run before authentication and find
 * nothing, and the RBAC denial should fire before the plan denial anyway.
 */
export function createGroupRestApp(options: {
  security: AppRestSecurity;
  organizations: () => OrganizationService;
  /** Groups are an Enterprise capability, so every route carries this gate. */
  enterpriseGate: MiddlewareHandler;
  /** Who a REST write is attributed to in the grants ledger (ADR-092). */
  ledgerActor: (c: Context<any>) => OrganizationLedgerActor;
}): SecuredApp<{ Variables: AppRestOrganizationVariables }> {
  const { security, organizations, enterpriseGate, ledgerActor } = options;

  const secured = security.createOrgApp({
    basePath: "/api/groups",
  });

  // A plan refusal is the caller's fact, not our outage: the Enterprise gate
  // answers 402 from every route in this family, and the shared handler logs
  // anything under 500 below error level for exactly that reason.
  secured.hono.onError(
    createFamilyErrorHandler({
      loggerName: "langwatch:api:groups:errors",
      label: "Groups API Error",
      boundary: security.legacyErrorHandler,
    }),
  );

  // ── List groups ────────────────────────────────────────────────────────────

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

        const result = await organizations().listGroups({
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

  // ── Create group ───────────────────────────────────────────────────────────

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

        const group = await organizations().createGroup({
          organizationId: organization.id,
          name: body.name,
          bindings: body.bindings,
          memberIds: body.memberIds,
          actor: ledgerActor(c),
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

  // ── Get group ──────────────────────────────────────────────────────────────

  secured
    .access(requires("organization:manage"))
    .get(
      "/:id",
      enterpriseGate,
      describeRoute({ description: "Get a group with members and bindings" }),
      async (c) => {
        const { id } = c.req.param();
        const organization = c.get("organization");

        const group = await organizations().getGroup({
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

  // ── Update group (rename) ──────────────────────────────────────────────────

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

        const group = await organizations().renameGroup({
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

  // ── Delete group ───────────────────────────────────────────────────────────

  secured
    .access(requires("organization:manage"))
    .delete("/:id", enterpriseGate, describeRoute({ description: "Delete a group" }), async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");

      await organizations().deleteGroup({
        groupId: id,
        organizationId: organization.id,
        actor: ledgerActor(c),
      });

      return c.json({ success: true });
    });

  // ── Members ────────────────────────────────────────────────────────────────

  secured
    .access(requires("organization:manage"))
    .get(
      "/:id/members",
      enterpriseGate,
      describeRoute({ description: "List members of a group" }),
      async (c) => {
        const { id } = c.req.param();
        const organization = c.get("organization");

        const group = await organizations().getGroup({
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

        await organizations().addGroupMember({
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

        await organizations().removeGroupMember({
          groupId: id,
          organizationId: organization.id,
          userId,
        });

        return c.json({ success: true });
      },
    );

  // ── Bindings ───────────────────────────────────────────────────────────────

  secured
    .access(requires("organization:manage"))
    .get(
      "/:id/bindings",
      enterpriseGate,
      describeRoute({ description: "List role bindings for a group" }),
      async (c) => {
        const { id } = c.req.param();
        const organization = c.get("organization");

        const bindings = await organizations().listGroupBindings({
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

        const binding = await organizations().addGroupBinding({
          groupId: id,
          organizationId: organization.id,
          binding: body,
          actor: ledgerActor(c),
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

        await organizations().removeGroupBinding({
          groupId: id,
          bindingId,
          organizationId: organization.id,
          actor: ledgerActor(c),
        });

        return c.json({ success: true });
      },
    );

  return secured;
}

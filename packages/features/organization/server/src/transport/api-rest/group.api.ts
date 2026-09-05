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
  organizationGroupRestBindingListSchema,
  organizationGroupRestBindingSchema,
  organizationGroupRestCreatedSchema,
  organizationGroupRestDetailsSchema,
  organizationGroupRestMemberListSchema,
  organizationGroupRestPageSchema,
  organizationGroupRestRenamedSchema,
  organizationRestSuccessSchema,
  type OrganizationLedgerActor,
  type OrganizationService,
} from "@langwatch/organization-contract";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  type AppRestSecurity,
  createFamilyErrorHandler,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
} from "@langwatch/api/rest";

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

const groupParamsSchema = z.object({ id: z.string().min(1) });
const groupMemberParamsSchema = groupParamsSchema.extend({ userId: z.string().min(1) });
const groupBindingParamsSchema = groupParamsSchema.extend({ bindingId: z.string().min(1) });

/** The organization the request is scoped to, as this transport reads it. */
const organizationOf = (c: Context): { id: string } => c.get("organization") as { id: string };

/**
 * The `/api/groups` family, built against one process's security.
 *
 * `enterpriseGate` is per-route middleware on purpose: the gate reads the
 * organization that org auth resolved onto the context, so a family-level
 * middleware would run before authentication and find nothing, and the RBAC
 * denial should fire before the plan denial anyway.
 */
export function createGroupRestApp(options: {
  security: AppRestSecurity;
  organizations: () => OrganizationService;
  /** Groups are an Enterprise capability, so every route carries this gate. */
  enterpriseGate: MiddlewareHandler;
  /** Who a REST write is attributed to in the grants ledger (ADR-092). */
  ledgerActor: (c: Context<any>) => OrganizationLedgerActor;
}): MountableRestApp {
  const { security, organizations, enterpriseGate, ledgerActor } = options;

  const { service, policy } = security.createVersionedApp({
    name: "groups",
    basePath: "/api/groups",
    routeMiddleware: [enterpriseGate],
    errorEnvelope: "legacy",
    // A plan refusal is the caller's fact, not our outage: the Enterprise gate
    // answers 402 from every route in this family, and the shared handler logs
    // anything under 500 below error level for exactly that reason.
    errorHandler: (boundary) =>
      createFamilyErrorHandler({
        loggerName: "langwatch:api:groups:errors",
        label: "Groups API Error",
        boundary,
      }),
  });

  const manage = policy("organization:manage");

  // ── handlers ───────────────────────────────────────────────────────────────

  const listGroupsHandler = async (c: Context, input: z.infer<typeof paginationQuerySchema>) => {
    const result = await organizations().listGroups({
      organizationId: organizationOf(c).id,
      page: input.page,
      limit: input.limit,
    });
    return {
      data: result.data.map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        externalId: g.externalId,
        scimSource: g.scimSource,
        memberCount: g.memberCount,
        bindings: g.bindings.map(bindingWire),
        createdAt: g.createdAt,
      })),
      pagination: result.pagination,
    };
  };

  const createGroupHandler = async (c: Context, input: z.infer<typeof createGroupSchema>) => {
    const group = await organizations().createGroup({
      organizationId: organizationOf(c).id,
      name: input.name,
      ...(input.bindings ? { bindings: input.bindings } : {}),
      ...(input.memberIds ? { memberIds: input.memberIds } : {}),
      actor: ledgerActor(c),
    });
    return {
      id: group.id,
      name: group.name,
      slug: group.slug,
      organizationId: group.organizationId,
      createdAt: group.createdAt,
    };
  };

  const getGroupHandler = async (c: Context, input: z.infer<typeof groupParamsSchema>) => {
    const group = await organizations().getGroup({
      groupId: input.id,
      organizationId: organizationOf(c).id,
    });
    return {
      id: group.id,
      name: group.name,
      slug: group.slug,
      externalId: group.externalId,
      scimSource: group.scimSource,
      members: group.members.map(memberWire),
      bindings: group.bindings.map(bindingWire),
    };
  };

  const renameGroupHandler = async (
    c: Context,
    input: z.infer<typeof groupParamsSchema> & z.infer<typeof updateGroupSchema>,
  ) => {
    const group = await organizations().renameGroup({
      groupId: input.id,
      organizationId: organizationOf(c).id,
      name: input.name,
    });
    return { id: group.id, name: group.name, slug: group.slug };
  };

  const deleteGroupHandler = async (c: Context, input: z.infer<typeof groupParamsSchema>) => {
    await organizations().deleteGroup({
      groupId: input.id,
      organizationId: organizationOf(c).id,
      actor: ledgerActor(c),
    });
    return { success: true };
  };

  const listMembersHandler = async (c: Context, input: z.infer<typeof groupParamsSchema>) => {
    const group = await organizations().getGroup({
      groupId: input.id,
      organizationId: organizationOf(c).id,
    });
    return { data: group.members.map(memberWire) };
  };

  const addMemberHandler = async (
    c: Context,
    input: z.infer<typeof groupParamsSchema> & z.infer<typeof addMemberSchema>,
  ) => {
    await organizations().addGroupMember({
      groupId: input.id,
      organizationId: organizationOf(c).id,
      userId: input.userId,
    });
    return { success: true };
  };

  const removeMemberHandler = async (
    c: Context,
    input: z.infer<typeof groupMemberParamsSchema>,
  ) => {
    await organizations().removeGroupMember({
      groupId: input.id,
      organizationId: organizationOf(c).id,
      userId: input.userId,
    });
    return { success: true };
  };

  const listBindingsHandler = async (c: Context, input: z.infer<typeof groupParamsSchema>) => {
    const bindings = await organizations().listGroupBindings({
      organizationId: organizationOf(c).id,
      groupId: input.id,
    });
    return { data: bindings.map(bindingWire) };
  };

  const addBindingHandler = async (
    c: Context,
    input: z.infer<typeof groupParamsSchema> & z.infer<typeof organizationGroupBindingInputSchema>,
  ) => {
    const { id, ...binding } = input;
    const created = await organizations().addGroupBinding({
      groupId: id,
      organizationId: organizationOf(c).id,
      binding,
      actor: ledgerActor(c),
    });
    return {
      id: created.id,
      role: created.role,
      scopeType: created.scopeType,
      scopeId: created.scopeId,
    };
  };

  const removeBindingHandler = async (
    c: Context,
    input: z.infer<typeof groupBindingParamsSchema>,
  ) => {
    await organizations().removeGroupBinding({
      groupId: input.id,
      bindingId: input.bindingId,
      organizationId: organizationOf(c).id,
      actor: ledgerActor(c),
    });
    return { success: true };
  };

  // ── service wiring ─────────────────────────────────────────────────────────

  return service
    .registerRoute("get", "/", MANAGEMENT_API_VERSION, listGroupsHandler, (b) =>
      manage(b)
        .withQuery(paginationQuerySchema)
        .withOutput(organizationGroupRestPageSchema)
        .withDocs({
          operationId: "listGroups",
          tags: ["Groups"],
          description: "List all groups for the organization",
        }),
    )
    .registerRoute("post", "/", MANAGEMENT_API_VERSION, createGroupHandler, (b) =>
      manage(b)
        .withInput(createGroupSchema)
        .withOutput(organizationGroupRestCreatedSchema)
        .withStatus(201)
        .withDocs({
          operationId: "createGroup",
          tags: ["Groups"],
          description: "Create a new group",
        }),
    )
    .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getGroupHandler, (b) =>
      manage(b)
        .withParams(groupParamsSchema)
        .withOutput(organizationGroupRestDetailsSchema)
        .withDocs({
          operationId: "getGroup",
          tags: ["Groups"],
          description: "Get a group with members and bindings",
        }),
    )
    .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, renameGroupHandler, (b) =>
      manage(b)
        .withParams(groupParamsSchema)
        .withInput(updateGroupSchema)
        .withOutput(organizationGroupRestRenamedSchema)
        .withDocs({
          operationId: "renameGroup",
          tags: ["Groups"],
          description: "Rename a group",
        }),
    )
    .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, deleteGroupHandler, (b) =>
      manage(b)
        .withParams(groupParamsSchema)
        .withOutput(organizationRestSuccessSchema)
        .withDocs({
          operationId: "deleteGroup",
          tags: ["Groups"],
          description: "Delete a group",
        }),
    )
    .registerRoute("get", "/:id/members", MANAGEMENT_API_VERSION, listMembersHandler, (b) =>
      manage(b)
        .withParams(groupParamsSchema)
        .withOutput(organizationGroupRestMemberListSchema)
        .withDocs({
          operationId: "listGroupMembers",
          tags: ["Groups"],
          description: "List members of a group",
        }),
    )
    .registerRoute("post", "/:id/members", MANAGEMENT_API_VERSION, addMemberHandler, (b) =>
      manage(b)
        .withParams(groupParamsSchema)
        .withInput(addMemberSchema)
        .withOutput(organizationRestSuccessSchema)
        .withStatus(201)
        .withDocs({
          operationId: "addGroupMember",
          tags: ["Groups"],
          description: "Add a member to a group",
        }),
    )
    .registerRoute(
      "delete",
      "/:id/members/:userId",
      MANAGEMENT_API_VERSION,
      removeMemberHandler,
      (b) =>
        manage(b)
          .withParams(groupMemberParamsSchema)
          .withOutput(organizationRestSuccessSchema)
          .withDocs({
            operationId: "removeGroupMember",
            tags: ["Groups"],
            description: "Remove a member from a group",
          }),
    )
    .registerRoute("get", "/:id/bindings", MANAGEMENT_API_VERSION, listBindingsHandler, (b) =>
      manage(b)
        .withParams(groupParamsSchema)
        .withOutput(organizationGroupRestBindingListSchema)
        .withDocs({
          operationId: "listGroupBindings",
          tags: ["Groups"],
          description: "List role bindings for a group",
        }),
    )
    .registerRoute("post", "/:id/bindings", MANAGEMENT_API_VERSION, addBindingHandler, (b) =>
      manage(b)
        .withParams(groupParamsSchema)
        .withInput(organizationGroupBindingInputSchema)
        .withOutput(organizationGroupRestBindingSchema)
        .withStatus(201)
        .withDocs({
          operationId: "addGroupBinding",
          tags: ["Groups"],
          description: "Add a role binding to a group",
        }),
    )
    .registerRoute(
      "delete",
      "/:id/bindings/:bindingId",
      MANAGEMENT_API_VERSION,
      removeBindingHandler,
      (b) =>
        manage(b)
          .withParams(groupBindingParamsSchema)
          .withOutput(organizationRestSuccessSchema)
          .withDocs({
            operationId: "removeGroupBinding",
            tags: ["Groups"],
            description: "Remove a role binding from a group",
          }),
    )
    .build();
}

/** One binding, as every route that reports one answers it. */
const bindingWire = (b: {
  id: string;
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  customRoleId: string | null;
  customRoleName: string | null;
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
}) => ({
  id: b.id,
  role: b.role,
  customRoleId: b.customRoleId,
  customRoleName: b.customRoleName,
  scopeType: b.scopeType,
  scopeId: b.scopeId,
});

/** One member, without the avatar this door does not publish. */
const memberWire = (m: { userId: string; name: string | null; email: string | null }) => ({
  userId: m.userId,
  name: m.name,
  email: m.email,
});

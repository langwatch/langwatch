/**
 * The organization management REST family: the organization profile, its
 * members, and its invites, addressed with no {orgId} segment because the
 * organization is implied by the credential.
 *
 * Built on `@langwatch/api` through `createManagementService`, so every
 * endpoint declares its RBAC permission once and gets the SecuredApp policy
 * registration, the org-key authentication (throwing mode), the permission
 * check (403) and the Enterprise plan gate (402) in that order. Every dated
 * version of a documented endpoint — plus `latest` — reaches the OpenAPI
 * document; there is no bare alias.
 *
 * Terraform-shaped: reads return every field a write accepts (the SSO fields
 * and the S3 secret are deliberately not owned by this API), PATCH is partial,
 * and deletes of missing resources answer their family's stable 404 code.
 *
 * This module is the registration and wiring seam only: the wire vocabulary
 * lives in `wire.ts` and the handlers in `handlers.ts`.
 */
import { z } from "zod";
import { appFromContext } from "~/app/api/middleware/app-context";
import { createManagementService } from "~/server/api/management/managed-service";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import { PrismaRoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.prisma.repository";
import { prisma } from "~/server/db";
import { InviteService } from "~/server/invites/invite.service";
import { RoleBindingService } from "~/server/role-bindings/role-binding.service";
import {
  createInvitesHandler,
  getMemberHandler,
  getOrganizationHandler,
  listInvitesHandler,
  listMembersHandler,
  memberAccessHandler,
  removeMemberHandler,
  revokeInviteHandler,
  updateMemberHandler,
  updateOrganizationHandler,
} from "./handlers";
import {
  accessBreakdownSchema,
  createdInvitesSchema,
  createInvitesSchema,
  inviteSchema,
  listMembersQuerySchema,
  memberSchema,
  memberWithTeamsSchema,
  organizationSettingsSchema,
  successSchema,
  updatedMemberSchema,
  updateMemberSchema,
  updateOrganizationSchema,
  userIdParamsSchema,
} from "./wire";

const { service, guard } = createManagementService({
  name: "organization",
  basePath: "/api/organization",
  feature: "MANAGEMENT_API",
});

// ── service wiring ───────────────────────────────────────────────────────────

export const app = service
  .provide({
    organizations: (_base, context) => appFromContext(context).organizations,
    invites: () => InviteService.create(prisma),
    roleBindings: (_base, context) =>
      new RoleBindingService({
        prisma,
        repo: new PrismaRoleBindingRepository(prisma),
        roleService: appFromContext(context).roles,
      }),
  })
  // ── profile ────────────────────────────────────────────────────────────────
  .registerRoute("get", "/", MANAGEMENT_API_VERSION, getOrganizationHandler, (b) =>
    guard("organization:view")(b)
      .withOutput(organizationSettingsSchema)
      .withDocs({
        operationId: "getOrganization",
        tags: ["Organization"],
        description:
          "Read the organization profile: name, slug, support contact, presence and trace sharing settings, and the S3 storage shape. The single sign-on fields and the S3 secret are never returned.",
      }),
  )
  .registerRoute("patch", "/", MANAGEMENT_API_VERSION, updateOrganizationHandler, (b) =>
    guard("organization:manage")(b)
      .withInput(updateOrganizationSchema)
      .withOutput(organizationSettingsSchema)
      .withDocs({
        operationId: "updateOrganization",
        tags: ["Organization"],
        description:
          "Update the organization profile. Partial: only the fields present are written, and the response is exactly what a subsequent GET returns.",
      }),
  )
  // ── member reads ───────────────────────────────────────────────────────────
  .registerRoute("get", "/members", MANAGEMENT_API_VERSION, listMembersHandler, (b) =>
    guard("organization:view")(b)
      .withQuery(listMembersQuerySchema)
      .withOutput(
        z.object({
          members: z.array(memberSchema),
          totalCount: z.number(),
        }),
      )
      .withDocs({
        operationId: "listOrganizationMembers",
        tags: ["Members"],
        description:
          "List the organization's members with their organization role and disabled status. Disabled members are included only when includeDisabled=true.",
      }),
  )
  .registerRoute(
    "get",
    "/members/:userId",
    MANAGEMENT_API_VERSION,
    getMemberHandler,
    (b) =>
      guard("organization:view")(b)
        .withParams(userIdParamsSchema)
        .withOutput(memberWithTeamsSchema)
        .withDocs({
          operationId: "getOrganizationMember",
          tags: ["Members"],
          description:
            "Read one member, including the teams they reach through team-scoped role bindings. Personal workspaces are not listed: they are not access an administrator manages.",
        }),
  )
  .registerRoute(
    "get",
    "/members/:userId/access",
    MANAGEMENT_API_VERSION,
    memberAccessHandler,
    (b) =>
      guard("organization:manage")(b)
        .withParams(userIdParamsSchema)
        .withOutput(accessBreakdownSchema)
        .withDocs({
          operationId: "getOrganizationMemberAccess",
          tags: ["Members"],
          description:
            "The member's full access breakdown: organization role, group memberships with their bindings, and direct bindings, each with the permissions it grants and the scope it grants them on.",
        }),
  )
  // ── member writes ──────────────────────────────────────────────────────────
  .registerRoute(
    "patch",
    "/members/:userId",
    MANAGEMENT_API_VERSION,
    updateMemberHandler,
    (b) =>
      guard("organization:manage")(b)
        .withParams(userIdParamsSchema)
        .withInput(updateMemberSchema)
        .withOutput(updatedMemberSchema)
        .withDocs({
          operationId: "updateOrganizationMember",
          tags: ["Members"],
          description:
            "Change a member's organization role, or disable / re-enable their membership. Send exactly one of role or disabled. Re-enabling consumes a seat, so it is checked against the plan.",
        }),
  )
  .registerRoute(
    "delete",
    "/members/:userId",
    MANAGEMENT_API_VERSION,
    removeMemberHandler,
    (b) =>
      guard("organization:manage")(b)
        .withParams(userIdParamsSchema)
        .withOutput(successSchema)
        .withDocs({
          operationId: "removeOrganizationMember",
          tags: ["Members"],
          description:
            "Remove a member from the organization and every team in it. The member the credential acts as cannot remove themselves.",
        }),
  )
  // ── invites ────────────────────────────────────────────────────────────────
  .registerRoute("get", "/invites", MANAGEMENT_API_VERSION, listInvitesHandler, (b) =>
    guard("organization:manage")(b)
      .withOutput(z.object({ invites: z.array(inviteSchema) }))
      .withDocs({
        operationId: "listOrganizationInvites",
        tags: ["Invites"],
        description:
          "List pending invites. Each carries its invite code and acceptance link, because a provisioning run with no email provider still has to hand the person something to open.",
      }),
  )
  .registerRoute("post", "/invites", MANAGEMENT_API_VERSION, createInvitesHandler, (b) =>
    guard("organization:manage")(b)
      .withInput(createInvitesSchema)
      .withOutput(createdInvitesSchema)
      .withStatus(201)
      .withDocs({
        operationId: "createOrganizationInvites",
        tags: ["Invites"],
        description:
          "Create up to 50 invites in one batch, each with team assignments that may carry a custom role. Validation is strict: a team or custom role that cannot be assigned refuses the batch rather than silently granting less than was asked. emailNotSent reports, per invite, whether the invite email could be delivered.",
      }),
  )
  .registerRoute(
    "delete",
    "/invites/:id",
    MANAGEMENT_API_VERSION,
    revokeInviteHandler,
    (b) =>
      guard("organization:manage")(b)
        .withParams(z.object({ id: z.string().min(1) }))
        .withOutput(successSchema)
        .withDocs({
          operationId: "revokeOrganizationInvite",
          tags: ["Invites"],
          description:
            "Revoke a pending invite. An invite id from another organization, or one already revoked, answers 404.",
        }),
  )
  .build();

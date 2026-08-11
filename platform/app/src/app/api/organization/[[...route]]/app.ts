/**
 * The organization management REST family: the organization profile, its
 * members, and its invites, addressed with no {orgId} segment because the
 * organization is implied by the credential.
 *
 * Built on `@langwatch/api` through `createManagementService`, so every
 * endpoint declares its RBAC permission once and gets the SecuredApp policy
 * registration, the org-key authentication (throwing mode), the permission
 * check (403) and the Enterprise plan gate (402) in that order. Only the bare
 * alias paths reach the OpenAPI document; the dated and `latest` mounts serve
 * traffic with version headers.
 *
 * Terraform-shaped: reads return every field a write accepts (the SSO fields
 * and the S3 secret are deliberately not owned by this API), PATCH is partial,
 * and deletes of missing resources answer their family's stable 404 code.
 *
 * This module is the registration and wiring seam only: the wire vocabulary
 * lives in `wire.ts` and the handlers in `handlers.ts`.
 */
import type { VersionBuilder } from "@langwatch/api";
import { z } from "zod";
import { createManagementService } from "~/server/api/management/managed-service";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import { PrismaRoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.prisma.repository";
import { prisma } from "~/server/db";
import { InviteService } from "~/server/invites/invite.service";
import { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import { RoleService } from "~/server/role/role.service";
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
  type OrganizationFamilyApp,
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

type OrganizationVersion = VersionBuilder<OrganizationFamilyApp>;

// ── endpoint registration ────────────────────────────────────────────────────

const registerProfileEndpoints = (v: OrganizationVersion): void => {
  v.get(
    "/",
    {
      ...guard("organization:view"),
      output: organizationSettingsSchema,
      description:
        "Read the organization profile: name, slug, support contact, presence and trace sharing settings, and the S3 storage shape. The single sign-on fields and the S3 secret are never returned.",
      docs: { operationId: "getOrganization", tags: ["Organization"] },
    },
    getOrganizationHandler,
  );

  v.patch(
    "/",
    {
      ...guard("organization:manage"),
      input: updateOrganizationSchema,
      output: organizationSettingsSchema,
      description:
        "Update the organization profile. Partial: only the fields present are written, and the response is exactly what a subsequent GET returns.",
      docs: { operationId: "updateOrganization", tags: ["Organization"] },
    },
    updateOrganizationHandler,
  );
};

const registerMemberReadEndpoints = (v: OrganizationVersion): void => {
  v.get(
    "/members",
    {
      ...guard("organization:view"),
      query: listMembersQuerySchema,
      output: z.object({
        members: z.array(memberSchema),
        totalCount: z.number(),
      }),
      description:
        "List the organization's members with their organization role and disabled status. Disabled members are included only when includeDisabled=true.",
      docs: { operationId: "listOrganizationMembers", tags: ["Members"] },
    },
    listMembersHandler,
  );

  v.get(
    "/members/:userId",
    {
      ...guard("organization:view"),
      params: userIdParamsSchema,
      output: memberWithTeamsSchema,
      description:
        "Read one member, including the teams they reach through team-scoped role bindings. Personal workspaces are not listed: they are not access an administrator manages.",
      docs: { operationId: "getOrganizationMember", tags: ["Members"] },
    },
    getMemberHandler,
  );

  v.get(
    "/members/:userId/access",
    {
      ...guard("organization:manage"),
      params: userIdParamsSchema,
      output: accessBreakdownSchema,
      description:
        "The member's full access breakdown: organization role, group memberships with their bindings, and direct bindings, each with the permissions it grants and the scope it grants them on.",
      docs: { operationId: "getOrganizationMemberAccess", tags: ["Members"] },
    },
    memberAccessHandler,
  );
};

const registerMemberWriteEndpoints = (v: OrganizationVersion): void => {
  v.patch(
    "/members/:userId",
    {
      ...guard("organization:manage"),
      params: userIdParamsSchema,
      input: updateMemberSchema,
      output: updatedMemberSchema,
      description:
        "Change a member's organization role, or disable / re-enable their membership. Send exactly one of role or disabled. Re-enabling consumes a seat, so it is checked against the plan.",
      docs: { operationId: "updateOrganizationMember", tags: ["Members"] },
    },
    updateMemberHandler,
  );

  v.delete(
    "/members/:userId",
    {
      ...guard("organization:manage"),
      params: userIdParamsSchema,
      output: successSchema,
      description:
        "Remove a member from the organization and every team in it. The member the credential acts as cannot remove themselves.",
      docs: { operationId: "removeOrganizationMember", tags: ["Members"] },
    },
    removeMemberHandler,
  );
};

const registerInviteEndpoints = (v: OrganizationVersion): void => {
  v.get(
    "/invites",
    {
      ...guard("organization:manage"),
      output: z.object({ invites: z.array(inviteSchema) }),
      description:
        "List pending invites. Each carries its invite code and acceptance link, because a provisioning run with no email provider still has to hand the person something to open.",
      docs: { operationId: "listOrganizationInvites", tags: ["Invites"] },
    },
    listInvitesHandler,
  );

  v.post(
    "/invites",
    {
      ...guard("organization:manage"),
      input: createInvitesSchema,
      output: createdInvitesSchema,
      status: 201,
      description:
        "Create up to 50 invites in one batch, each with team assignments that may carry a custom role. Validation is strict: a team or custom role that cannot be assigned refuses the batch rather than silently granting less than was asked. emailNotSent reports, per invite, whether the invite email could be delivered.",
      docs: { operationId: "createOrganizationInvites", tags: ["Invites"] },
    },
    createInvitesHandler,
  );

  v.delete(
    "/invites/:id",
    {
      ...guard("organization:manage"),
      params: z.object({ id: z.string().min(1) }),
      output: successSchema,
      description:
        "Revoke a pending invite. An invite id from another organization, or one already revoked, answers 404.",
      docs: { operationId: "revokeOrganizationInvite", tags: ["Invites"] },
    },
    revokeInviteHandler,
  );
};

// ── service wiring ───────────────────────────────────────────────────────────

export const app = service
  .provide({
    organizations: () =>
      new OrganizationService(
        new PrismaOrganizationRepository(prisma),
        new PromptTagRepository(prisma),
      ),
    invites: () => InviteService.create(prisma),
    roleBindings: () =>
      new RoleBindingService(
        prisma,
        new PrismaRoleBindingRepository(prisma),
        new RoleService(prisma),
      ),
  })
  .version(MANAGEMENT_API_VERSION, (v) => {
    registerProfileEndpoints(v);
    registerMemberReadEndpoints(v);
    registerMemberWriteEndpoints(v);
    registerInviteEndpoints(v);
  })
  .build();

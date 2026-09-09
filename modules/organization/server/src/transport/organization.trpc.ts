/**
 * The server half of `organization.*`: a permission and a handler per
 * procedure the contract already named. The orchestration each door used to
 * carry - per-viewer redaction, the invitation ceremony, the seat and plan
 * guards - lives in the application, so this file states access and forwards.
 *
 * Two facts travel beside the input because three collaborators identify the
 * operator by more than their id: the plan provider, the seat guard and the
 * disable guard all read the signed-in person's display name and address.
 */

import { defineTrpcFact, defineTrpcRouter, type TrpcHandlerActor } from "@langwatch/api/trpc";
import type { AuthzDeclaration } from "@langwatch/authz-contract";
import {
  OrganizationApi,
  organizationTrpc,
  type OrganizationCaller,
} from "@langwatch/organization-contract";
import { z } from "zod";

/** The signed-in person as the process's session carries them, beside their id. */
export const organizationSessionPersonFact = defineTrpcFact(
  "organizationSessionPerson",
  z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
);

/** What one session person looks like once the fact has been parsed. */
type SessionPerson = Readonly<{ name: string | null; email: string | null }> | null;

/**
 * The one opt-out this namespace makes, and the same sentence for all three
 * procedures that make it: each runs before or across membership, so there is
 * no scope to check and no permission the caller could hold.
 */
const BEFORE_MEMBERSHIP = {
  reason:
    "runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite",
} as const;

/** `organization:manage`, resolved from the team the change addresses. */
const MANAGE_VIA_TEAM: AuthzDeclaration = {
  kind: "permission",
  permission: "organization:manage",
  via: "teamId",
};

/**
 * `auditLog:view` at the ORGANIZATION tier, always. The permission is grantable
 * at three tiers and `projectId` is an optional FILTER here, so leaving the
 * tier to be inferred would move the whole check to the project and leave the
 * organization the query is anchored on unauthorized. The extra project-tier
 * question a filter earns is asked in the application.
 */
const AUDIT_LOG_VIEW: AuthzDeclaration = {
  kind: "permission",
  permission: "auditLog:view",
  via: "organizationId",
};

/** Who is asking, as every write on this namespace is attributed. */
function callerOf(actor: TrpcHandlerActor, person: SessionPerson): OrganizationCaller {
  return { id: actor.id, name: person?.name ?? null, email: person?.email ?? null };
}

export const organizationTrpcTransport = defineTrpcRouter(OrganizationApi, organizationTrpc)
  .procedure("createAndAssign")
  .withFacts(organizationSessionPersonFact)
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(async ({ app, input, actor }, person) => {
    const caller = callerOf(actor, person);
    const result = await app.createAndAssign(
      {
        orgName: input.orgName,
        phoneNumber: input.phoneNumber,
        signUpData: input.signUpData,
        primaryIntent: input.primaryIntent,
        userDisplayName: caller.name,
      },
      caller,
    );

    return { success: true as const, organization: result.organization, team: result.team };
  })

  // The self-removal guard lives in the service: it refuses with
  // `cannot_remove_self`, which the client renders its own copy for.
  .procedure("deleteMember")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }, person) => {
    await app.deleteMember(input, callerOf(actor, person));

    return { success: true as const };
  })

  /**
   * Disables or re-enables a membership so an organization can reconcile down
   * to the seats its licence covers. See seat-reconciliation.feature.
   */
  .procedure("setMemberDisabled")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }, person) => {
    await app.setMemberDisabled(input, callerOf(actor, person));

    return { success: true as const };
  })

  /** The shell's first read: every organization this person can reach. */
  .procedure("getAll")
  .withFacts(organizationSessionPersonFact)
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(({ app, input, actor }, person) =>
    app.listVisibleOrganizations({ isDemo: input?.isDemo ?? false }, callerOf(actor, person)),
  )

  .procedure("update")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) => {
    // The form round-trips every S3 field, so absent here means "clear it"  - 
    // though `updateSettings` treats absent as "leave alone" for `s3Bucket`.
    await app.updateSettings({
      organizationId: input.organizationId,
      name: input.name,
      s3Endpoint: input.s3Endpoint ?? null,
      s3AccessKeyId: input.s3AccessKeyId ?? null,
      s3SecretAccessKey: input.s3SecretAccessKey ?? null,
      s3Bucket: input.s3Bucket,
      presenceEnabled: input.presenceEnabled,
      traceSharingEnabled: input.traceSharingEnabled,
      supportContact: input.supportContact,
      primaryIntent: input.primaryIntent,
    });

    return { success: true as const };
  })

  /**
   * Stays at `organization:view`: non-admin pickers (annotation assignment,
   * trace participants, group dialogs) enumerate members by name. Addresses
   * are redacted for a caller who cannot administer, in the application.
   */
  .procedure("getOrganizationWithMembersAndTheirTeams")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:view")
  .handle(({ app, input, actor }, person) =>
    app.getOrganizationWithMembersForPicker(
      {
        organizationId: input.organizationId,
        includeDeactivated: input.includeDeactivated ?? false,
      },
      callerOf(actor, person),
    ),
  )

  /**
   * `organization:manage`, not `view`: one member's full record - role
   * assignments, team memberships - is an admin-surface read.
   */
  .procedure("getMemberById")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:manage")
  .handle(({ app, input, actor }, person) => app.getMemberOrRefuse(input, callerOf(actor, person)))

  .procedure("createInvites")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:manage")
  .handle(({ app, input, actor }, person) => app.createInvitations(input, callerOf(actor, person)))

  .procedure("deleteInvite")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) => {
    await app.revokeInvitation(input);
  })

  .procedure("resendInvite")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.resendInvitation(input))

  /**
   * Pending invitations expose admin intent - who is being added, with what
   * role, to which teams - so this is a manage read rather than a view one.
   */
  .procedure("getOrganizationPendingInvites")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.listPendingInvitations(input))

  .procedure("acceptInvite")
  .withFacts(organizationSessionPersonFact)
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(({ app, input, actor }, person) =>
    app.acceptInvitation({ inviteCode: input.inviteCode }, callerOf(actor, person)),
  )

  .procedure("updateTeamMemberRole")
  .withFacts(organizationSessionPersonFact)
  .withPermission(MANAGE_VIA_TEAM)
  .handle(async ({ app, input, actor }, person) => {
    await app.changeTeamMemberRole(input, callerOf(actor, person));

    return { success: true as const };
  })

  /**
   * `organization:manage`, not `view`: the full member list with addresses is
   * admin-surface personal data. A picker that needs names uses the read
   * above, which redacts them.
   */
  .procedure("getAllOrganizationMembers")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.getAllMembers({ organizationId: input.organizationId }))

  .procedure("updateMemberRole")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }, person) => {
    const caller = callerOf(actor, person);
    // The whole orchestration - personal-workspace assertion, shared-team
    // scoping, seat classification, the Enterprise gate for custom roles  - 
    // lives in the service, so the REST surface runs the same rules.
    const { teamsLeftWithoutAdmin } = await app.changeMemberRole(
      {
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        teamRoleUpdates: input.teamRoleUpdates,
        planUser: caller,
      },
      caller,
    );

    // Reported rather than refused: correcting a seat down to Viewer can take
    // away a shared team's only team-scoped admin, which is allowed because
    // organization admins administer every shared team anyway.
    return { success: true as const, teamsLeftWithoutAdmin };
  })

  .procedure("getAuditLogs")
  .withFacts(organizationSessionPersonFact)
  .withPermission(AUDIT_LOG_VIEW)
  .handle(({ app, input, actor }, person) => app.readAuditLogs(input, callerOf(actor, person)))
  .build();

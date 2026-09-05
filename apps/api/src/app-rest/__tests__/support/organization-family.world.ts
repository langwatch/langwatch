/**
 * One organization's profile, membership and invitations, held in memory behind the two
 * service interfaces `/api/organization` is composed over.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type {
  AuthzAccessBreakdownInput,
  AuthzAccessBreakdownOutput,
  AuthzService,
} from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  organizationSettingsSchema,
  updateOrganizationSettingsInputSchema,
  PersonalWorkspaceNotManagedHereError,
  type OrganizationSettings,
} from "@langwatch/organization-contract";
import {
  AlreadyOrganizationMemberError,
  CannotDisableSelfError,
  CannotRemoveLastAdminError,
  CannotRemoveSelfError,
  DuplicateInviteError,
  InviteNotFoundError,
  MemberNotFoundError,
  type OrganizationRestInviteService,
  type OrganizationRestMemberSummary,
  type OrganizationRestService,
} from "@langwatch/organization-server";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";

import { ApiOrganizationMissingCredentialsError } from "../../../api-rest.security";
import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition";
import {
  mountRestFamily,
  TEST_ORGANIZATION_ID,
  TEST_USER_ID,
  type MountedRestFamily,
} from "./rest-family.harness";

/** The credential every request in these suites carries unless it drops it. */
export const ORGANIZATION_BEARER = { authorization: "Bearer org-key" };

/** The version namespace the family's dated paths are registered under. */
export const ORGANIZATION_BASE = "/api/v1/organization/latest";

/** What a settings read is allowed to carry, taken from the contract itself. */
const settingsProjection = z.object(organizationSettingsSchema.shape);

export type OrganizationMemberSeed = {
  userId: string;
  name?: string | null;
  email?: string | null;
  role?: "ADMIN" | "MEMBER" | "EXTERNAL";
  disabled?: boolean;
  teams?: Array<{ teamId: string; teamName: string; role: string; customRoleId?: string | null }>;
};

export type OrganizationInviteSeed = {
  id: string;
  email: string;
  role?: "ADMIN" | "MEMBER" | "EXTERNAL";
  status?: "PENDING" | "REVOKED";
  teamIds?: string;
  teamAssignments?: unknown;
};

export type OrganizationWorldOptions = {
  /** Fields overriding the seeded organization profile. */
  organization?: Partial<OrganizationSettings>;
  /** Fields this API does not own, stored beside the profile. */
  sso?: { ssoDomain: string; ssoProvider: string };
  members?: OrganizationMemberSeed[];
  invites?: OrganizationInviteSeed[];
  /** Team ids a personal workspace occupies; an invite onto one is refused. */
  personalTeamIds?: string[];
  /** Active member seats the plan carries. Absent means unmetered. */
  seats?: number;
  /** The plan the gate reads; anything but ENTERPRISE refuses the family. */
  planType?: string;
  /** The person the credential acts as; null is a service key acting as nobody. */
  actingUserId?: string | null;
  /** Whether this deployment composed an invitation service at all. */
  withInvites?: boolean;
  /** Whether the caller presents a credential; false drives the 401 path. */
  credentialed?: boolean;
};

export type OrganizationWorld = {
  api: MountedRestFamily;
  /** The stored profile, including the fields the API does not own. */
  organization: () => OrganizationSettings & {
    ssoDomain: string | null;
    ssoProvider: string | null;
  };
  member: (userId: string) => MemberRow | undefined;
  invites: () => InviteRow[];
};

type MemberRow = OrganizationRestMemberSummary & {
  teams: Array<{
    teamId: string;
    teamName: string;
    role: string;
    customRoleId: string | null;
    customRoleName: string | null;
  }>;
};

type InviteRow = {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  inviteCode: string;
  teamIds: string;
  teamAssignments: unknown;
  expiration: Date | null;
  createdAt: Date;
};

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

const inviteUrlFor = (inviteCode: string) =>
  `https://app.langwatch.test/invite/accept?inviteCode=${inviteCode}`;

/** The licence layer's own overflow code, which the family renames at its seam. */
const seatOverflow = (current: number, max: number): never => {
  throw new HandledError("resource_limit_exceeded", "The plan's seats are all in use", {
    httpStatus: 403,
    meta: { limitType: "members", current, max },
  });
};

export function organizationWorld(options: OrganizationWorldOptions = {}): OrganizationWorld {
  const stored = {
    ...settingsProjection.parse({
      id: TEST_ORGANIZATION_ID,
      name: "Acme",
      slug: "acme",
      supportContact: "support@acme.test",
      presenceEnabled: true,
      traceSharingEnabled: true,
      primaryIntent: "LLM_OPS",
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3Bucket: null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
      ...options.organization,
    }),
    ssoDomain: options.sso?.ssoDomain ?? null,
    ssoProvider: options.sso?.ssoProvider ?? null,
  };

  const members = new Map<string, MemberRow>();
  for (const seed of options.members ?? []) {
    members.set(seed.userId, {
      userId: seed.userId,
      organizationId: TEST_ORGANIZATION_ID,
      role: (seed.role ?? "MEMBER") as OrganizationRestMemberSummary["role"],
      disabledAt: seed.disabled ? EPOCH : null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
      user: {
        id: seed.userId,
        name: seed.name ?? `Member ${seed.userId}`,
        email: seed.email ?? `${seed.userId}@acme.test`,
      },
      teams: (seed.teams ?? []).map((team) => ({
        teamId: team.teamId,
        teamName: team.teamName,
        role: team.role,
        customRoleId: team.customRoleId ?? null,
        customRoleName: team.customRoleId ? "Invite Role" : null,
      })),
    });
  }

  const invites: InviteRow[] = (options.invites ?? []).map((seed) => ({
    id: seed.id,
    organizationId: TEST_ORGANIZATION_ID,
    email: seed.email,
    role: seed.role ?? "MEMBER",
    status: seed.status ?? "PENDING",
    inviteCode: `code-${seed.id}`,
    teamIds: seed.teamIds ?? "",
    teamAssignments: seed.teamAssignments ?? null,
    expiration: null,
    createdAt: EPOCH,
  }));

  const activeCount = () =>
    [...members.values()].filter((member) => member.disabledAt === null).length;
  const activeAdmins = () =>
    [...members.values()].filter((member) => member.disabledAt === null && member.role === "ADMIN");
  const seatsLeft = () =>
    options.seats === undefined ? Number.POSITIVE_INFINITY : options.seats - activeCount();
  const found = (userId: string): MemberRow => {
    const member = members.get(userId);
    if (!member) throw new MemberNotFoundError(userId);
    return member;
  };

  const organizations: OrganizationRestService = {
    getSettings: async () => settingsProjection.parse(stored),
    updateSettings: async (input) => {
      const parsed = updateOrganizationSettingsInputSchema.parse(input);
      const { organizationId: _organizationId, s3SecretAccessKey: _secret, ...fields } = parsed;
      Object.assign(stored, fields);
      return { traceShareRevocationRequired: false };
    },
    listMembers: async ({ includeDisabled }) => {
      const rows = [...members.values()].filter(
        (member) => includeDisabled === true || member.disabledAt === null,
      );
      return { members: rows, totalCount: rows.length };
    },
    getMember: async ({ userId }) => found(userId),
    changeMemberRole: async ({ userId, role }) => {
      found(userId).role = role;
      return { teamsLeftWithoutAdmin: [] };
    },
    setMemberDisabled: async ({ userId, disabled, actingUser }) => {
      const member = found(userId);
      if (disabled && actingUser?.id === userId) throw new CannotDisableSelfError();
      if (!disabled && member.disabledAt !== null && seatsLeft() <= 0) {
        seatOverflow(activeCount(), options.seats ?? 0);
      }
      member.disabledAt = disabled ? EPOCH : null;
    },
    deleteMember: async ({ userId, actingUserId }) => {
      const member = found(userId);
      if (actingUserId === userId) throw new CannotRemoveSelfError();
      const admins = activeAdmins();
      if (member.role === "ADMIN" && member.disabledAt === null && admins.length <= 1) {
        throw new CannotRemoveLastAdminError();
      }
      members.delete(userId);
    },
  };

  const inviteService: OrganizationRestInviteService = {
    listInvites: async () =>
      invites.map((invite) => ({ ...invite, inviteUrl: inviteUrlFor(invite.inviteCode) }) as never),
    createInvites: async ({ invites: requested }) => {
      for (const request of requested) {
        for (const team of request.teams) {
          if ((options.personalTeamIds ?? []).includes(team.teamId)) {
            throw new PersonalWorkspaceNotManagedHereError();
          }
        }
        const member = [...members.values()].find(
          (row) => row.user.email?.toLowerCase() === request.email.toLowerCase(),
        );
        if (member) throw new AlreadyOrganizationMemberError(request.email);
        const pending = invites.find(
          (invite) =>
            invite.status === "PENDING" &&
            invite.email.toLowerCase() === request.email.toLowerCase(),
        );
        if (pending) throw new DuplicateInviteError(request.email);
      }
      if (requested.length > seatsLeft()) {
        seatOverflow(activeCount(), options.seats ?? 0);
      }
      const created = requested.map((request, index) => {
        const row: InviteRow = {
          id: `invite-${invites.length + index + 1}`,
          organizationId: TEST_ORGANIZATION_ID,
          email: request.email,
          role: request.role,
          status: "PENDING",
          inviteCode: `code-${invites.length + index + 1}`,
          teamIds: "",
          teamAssignments: request.teams.map((team) => ({
            teamId: team.teamId,
            role: team.role,
            customRoleId: team.customRoleId ?? null,
          })),
          expiration: null,
          createdAt: EPOCH,
        };
        invites.push(row);
        return { invite: row as never, emailNotSent: false };
      });
      return { organization: {} as never, invites: created };
    },
    revokeInvite: async ({ inviteId }) => {
      const invite = invites.find((row) => row.id === inviteId);
      if (!invite || invite.status !== "PENDING") throw new InviteNotFoundError();
      invite.status = "REVOKED";
      return { success: true as const };
    },
  };

  const permissions = {
    getAccessBreakdown: async ({
      organizationId,
      userId,
      userName,
      userEmail,
    }: AuthzAccessBreakdownInput): Promise<AuthzAccessBreakdownOutput> => {
      const member = found(userId);
      return {
        user: {
          id: userId,
          name: userName,
          email: userEmail,
          orgRole: member.role as AuthzAccessBreakdownOutput["user"]["orgRole"],
          orgRolePermissions: ["organization:view"],
        },
        groups: [],
        directBindings: [
          {
            id: "binding-organization",
            role: member.role,
            customRoleName: null,
            scopeType: "ORGANIZATION" as const,
            scopeId: organizationId,
            scopeName: stored.name,
            permissions: ["organization:view"],
          },
          ...member.teams.map((team) => ({
            id: `binding-${team.teamId}`,
            role: team.role,
            customRoleName: team.customRoleName,
            scopeType: "TEAM" as const,
            scopeId: team.teamId,
            scopeName: team.teamName,
            permissions: ["project:view"],
          })),
          {
            id: "binding-project",
            role: "VIEWER",
            customRoleName: null,
            scopeType: "PROJECT" as const,
            scopeId: "project-1",
            scopeName: "Acme",
            permissions: ["traces:view"],
          },
        ],
      };
    },
  } as unknown as AuthzService;

  const api = mountRestFamily({
    security: organizationSecurity({
      credentialed: options.credentialed ?? true,
      actingUserId: options.actingUserId === undefined ? TEST_USER_ID : options.actingUserId,
    }),
    services: {
      organizationManagement: {
        organizations: () => organizations,
        permissions: () => permissions,
        plans: () =>
          ({
            getActivePlan: async () => ({ type: options.planType ?? "ENTERPRISE" }),
          }) as never,
        shares: () => ({}) as never,
        projects: () => ({}) as never,
        audit: () => {},
        ...(options.withInvites === false
          ? {}
          : { invites: () => inviteService, buildInviteAcceptUrl: inviteUrlFor }),
      },
    } as never,
  });

  return {
    api,
    organization: () => ({ ...stored }),
    member: (userId) => members.get(userId),
    invites: () => invites.map((invite) => ({ ...invite })),
  };
}

/**
 * The harness security, plus the one refusal this family's own suite drives:
 * a request with no Authorization header never reaches a handler.
 */
function organizationSecurity(options: {
  credentialed: boolean;
  actingUserId: string | null;
}): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const asOrganization: MiddlewareHandler = async (c, next) => {
    if (!options.credentialed || !c.req.header("authorization")) {
      throw new ApiOrganizationMissingCredentialsError();
    }
    c.set("organization", { id: TEST_ORGANIZATION_ID, name: "Acme", slug: "acme" });
    if (options.actingUserId !== null) c.set("apiKeyUserId", options.actingUserId);
    await next();
  };

  return createAppRestSecurity({
    ...ApiRestObservabilityComposition.create(),
    authenticateProject: () => pass,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => asOrganization,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: asOrganization,
    authorizeOrganizationPermissionThrowing: () => pass,
  } as never);
}

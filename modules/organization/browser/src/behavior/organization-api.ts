/**
 * Hand-written until the mounted router can generate it (ADR-130).
 * `organization`/`limits` are load-bearing tRPC cache-key segments — renaming
 * one stops sharing a cache with `api.organization.*` call sites that haven't moved.
 */

import {
  createModuleApi,
  type ContractApiMap,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import type {
  AuthzApplyMemberBindingsInput,
  AuthzChangeGrantRoleInput,
  AuthzCreateGrantInput,
  AuthzListManagedBindingsForOrganizationInput,
  AuthzListManagedBindingsForOrganizationOutput,
  AuthzListManagedBindingsForUserInput,
  AuthzListManagedBindingsForUserOutput,
  AuthzRevokeGrantByIdInput,
  Grant,
  GrantRevoked,
} from "@langwatch/authz-contract";
import type { Plan } from "@langwatch/entitlement-contract";
import type { JoinLookupDecision } from "@langwatch/identity-contract";
import type {
  EnrichedAuditLog,
  groupTrpc,
  licenseEnforcementTrpc,
  JoinRequestAutomaticJoins,
  JoinRequestMine,
  JoinRequestPending,
  OrganizationInvite,
  OrganizationMemberProvenance,
  OrganizationUser,
  ScopeGraphOrganization,
  User,
} from "@langwatch/organization-contract";

import type { TeamRoleValue } from "../model/member-role-constraints.ts";
import type { OrganizationUserRole, TeamUserRole } from "../model/prisma-types.ts";

/**
 * The export must send this exact shape: a pre-filtered deep-link that
 * silently widened to the whole organization's history would be a
 * disclosure dressed up as a convenience.
 */
export type AuditLogFilters = {
  organizationId: string;
  projectId?: string;
  userId?: string;
  action?: string;
  startDate?: number;
  endDate?: number;
  targetKind?: string;
  targetId?: string;
};

/** One page of the audit trail. */
export type AuditLogPage = {
  auditLogs: EnrichedAuditLog[];
  totalCount: number;
};

/** A member row, as the "search by user" box matches against it. */
export type OrganizationMemberMatch = {
  userId: string;
  user: { id: string; name: string | null; email: string | null };
};

/** A team, as every team-shaped read in this family answers one. */
export type TeamReading = {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
};

/** A project inside a team. */
export type TeamProjectReading = {
  id: string;
  name: string;
  slug: string;
};

/**
 * `isPersonal` arrives only on LIST reads (not on {@link TeamReading}); the
 * edit-project drawer uses it to exclude the personal workspace as a move
 * target.
 */
export type TeamWithProjects = TeamReading & {
  isPersonal: boolean;
  projects: TeamProjectReading[];
};

/**
 * `role` is the stored membership; `assignedRole` is the access row that
 * overrides it where one exists. The form offers the second and falls back
 * to the first, which is why both travel.
 */
export type TeamMemberReading = {
  userId: string;
  teamId: string;
  role: TeamUserRole;
  assignedRole?: TeamRoleValue | null;
  user: { id: string; name: string | null; email: string | null; image?: string | null };
};

/** A team with everything the team detail form edits. */
export type TeamWithMembers = TeamWithProjects & {
  members: TeamMemberReading[];
};

/**
 * FLAT: name and image sit on the row rather than a join. `viaGroupId`
 * marks a row un-editable in place — a grant held through a group is
 * changed on the group, not here.
 */
export type TeamAccessRow = {
  userId: string;
  name: string;
  image?: string | null;
  email?: string | null;
  role: TeamRoleValue;
  customRoleId?: string | null;
  customRoleName?: string | null;
  /** The access row itself, where one exists and can be edited in place. */
  bindingId?: string | null;
  viaGroupId?: string | null;
  viaGroupName?: string | null;
};

/**
 * `source` decides how a project row expands: `team` means the grant is
 * inherited and read-only here; `override` means it was set on the project
 * and can be changed. `teamRole` is what the override overrides.
 */
export type ProjectAccessRow = TeamAccessRow & {
  source: "team" | "override" | "group";
  teamRole?: TeamRoleValue | null;
  bindingId?: string | null;
};

export type TeamWithGrants = TeamWithProjects & {
  /**
   * Shown under the team, not the project, because that's where a reader
   * looks for "who can see this"; names the project each one reaches.
   */
  projectOnlyAccess: (TeamAccessRow & { projectName: string })[];
  directMembers: TeamAccessRow[];
  /** Who reaches each project, by project id. */
  projectAccess: Record<string, ProjectAccessRow[]>;
};

/** One member of the organization, with the teams they are on. */
export type OrganizationMemberWithTeams = {
  /** The MEMBERSHIP row's own id, which the team form's picker keys on. */
  id: string;
  name: string | null;
  email: string | null;
  userId: string;
  role: OrganizationUserRole;
  /** When the seat was freed reversibly. Null while the member is active. */
  disabledAt: OrganizationUser["disabledAt"];
  customRoleId?: string | null;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image?: string | null;
    pendingSince?: User["deactivatedAt"];
    /** When the ACCOUNT was deactivated, which outlives one organization. */
    deactivatedAt?: User["deactivatedAt"];
    /** Whether they proved the address, which joining by domain depends on. */
    emailVerified?: User["emailVerified"];
  };
  teamMemberships?: { teamId: string; role: TeamUserRole; team: { name: string } }[];
};

/** The organization the members page renders, with its people. */
export type OrganizationWithMembersAndTheirTeams = {
  id: string;
  name: string;
  members: OrganizationMemberWithTeams[];
};

/** An invitation that has not been accepted yet. */
export type OrganizationInviteReading = {
  id: string;
  email: string;
  role: OrganizationUserRole;
  status: string;
  /**
   * An invitation past its expiry is still `PENDING` in the row and EXPIRED
   * to a reader; the difference decides whether "resend" is offered.
   */
  displayStatus: string;
  inviteCode: string;
  expiration: NonNullable<OrganizationInvite["expiration"]>;
  teamIds: string;
};

/** A custom role, as the role pickers offer one. */
export type CustomRoleReading = {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
};

/** A department, as the department column and picker read one. */
export type DepartmentReading = {
  id: string;
  name: string;
};

/**
 * One department per entity, which is why the value is an id and not a
 * list: the picker is a single select and the column prints one chip.
 */
export type DepartmentAssignment = { id: string; departmentId: string | null };

export type DepartmentAssignments = {
  users: DepartmentAssignment[];
  teams: DepartmentAssignment[];
  projects: DepartmentAssignment[];
};

/** How an organization treats somebody arriving from a domain it verified. */
export type DomainJoinSetting = "off" | "request" | "auto";

/**
 * The DOMAIN is on the row rather than derived from the address: an
 * organization can verify more than one, so the table needs to say which.
 */
export type JoinRequestReading = {
  joinRequestId: string;
  email: string;
  name: string | null;
  domain: string;
  requestedAt: JoinRequestPending[number]["requestedAt"];
  expiresAt: NonNullable<JoinRequestPending[number]["expiresAt"]>;
};

/** `licenseEnforcement.*` and `group.*` derive from organization contracts; the rest is here. */
export type OrganizationApiMap = ContractApiMap<typeof licenseEnforcementTrpc> &
  ContractApiMap<typeof groupTrpc> & {
    organization: {
      /**
       * `pageOffset`/`pageSize` are real offset paging — a Prisma `skip` read,
       * not a keyset walk — which is why the footer drives its own offsets
       * rather than carrying a cursor.
       */
      getAuditLogs: {
        query: {
          input: AuditLogFilters & { pageOffset: number; pageSize: number };
          output: AuditLogPage;
        };
      };

      /**
       * The organization graph the application shell already holds. Asked by
       * the frontend feature (not the screen, which gets it via host port),
       * with the shell's same input, so it shares one cache entry per document.
       */
      getAll: {
        query: {
          input: { isDemo: boolean };
          output: {
            id: string;
            name: string;
            slug: string;
            teams: {
              id: string;
              name: string;
              slug: string;
              projects: { id: string; name: string; slug: string }[];
            }[];
          }[];
        };
      };

      /**
       * The scope skeleton the shell resolves against: a versioned, session-tier
       * read, so it shares the shell's one cache entry (and its invalidation).
       */
      getScopeGraph: {
        query: { input: Record<string, never>; output: ScopeGraphOrganization[] };
      };

      /**
       * One procedure, two readers: the audit page's user search and the
       * members table. `OrganizationMemberMatch` stays exported as the audit
       * page's narrower view (`members[].user`) of the same row.
       */
      getOrganizationWithMembersAndTheirTeams: {
        query: {
          input: { organizationId: string; includeDeactivated?: boolean };
          output: OrganizationWithMembersAndTheirTeams;
        };
      };

      /** One member, as the person drawer opens them. */
      getMemberById: {
        query: {
          input: { organizationId: string; userId: string };
          output: OrganizationMemberWithTeams;
        };
      };

      /** Why each member is here, keyed by user id; asked apart so failing costs only the chips. */
      getMemberProvenance: {
        query: {
          input: { organizationId: string };
          output: Record<string, OrganizationMemberProvenance>;
        };
      };

      /** The same list, flat, for the pickers that only need names. */
      getAllOrganizationMembers: {
        query: {
          input: { organizationId: string };
          output: OrganizationMemberWithTeams[];
        };
      };

      /** Removes a seat outright. */
      deleteMember: {
        mutation: { input: { organizationId: string; userId: string }; output: unknown };
      };

      /** Frees a seat reversibly, which is what a licence counts. */
      setMemberDisabled: {
        mutation: {
          input: { organizationId: string; userId: string; disabled: boolean };
          output: unknown;
        };
      };

      updateMemberRole: {
        mutation: {
          input: {
            organizationId: string;
            userId: string;
            role: OrganizationUserRole;
            customRoleId?: string | null;
          };
          /**
           * Named rather than counted: the dialog lists them, and a warning
           * saying "three teams" without which three is one an administrator
           * cannot act on.
           */
          output: { teamsLeftWithoutAdmin?: { id: string; name: string }[] };
        };
      };
    };

    invite: {
      getOrganizationPendingInvites: {
        query: { input: { organizationId: string }; output: OrganizationInviteReading[] };
      };

      /**
       * ONE RESULT PER INVITE: `emailNotSent` is set when there's no mail
       * provider, since the invite is still CREATED and a link is handed back
       * to send by hand — a per-row flag, not a failure.
       */
      createInvites: {
        mutation: {
          input: {
            organizationId: string;
            invites: {
              email: string;
              role: OrganizationUserRole;
              teams?: { teamId: string; role: TeamRoleValue; customRoleId?: string | null }[];
            }[];
          };
          output: ({
            invite: OrganizationInviteReading;
            emailNotSent?: boolean;
          } | null)[];
        };
      };

      deleteInvite: {
        mutation: { input: { organizationId: string; inviteId: string }; output: unknown };
      };

      resendInvite: {
        mutation: {
          input: { organizationId: string; inviteId: string };
          output: { invite: OrganizationInviteReading; emailNotSent?: boolean };
        };
      };
    };

    limits: {
      /**
       * TWO READERS, ONE ENTRY: the audit page's Enterprise gate reads
       * `activePlan.type`, and the seat meter reads the two counts — same
       * procedure, same cache key, one round trip.
       */
      getUsage: {
        query: {
          input: { organizationId: string };
          output: {
            activePlan: { type: string };
            membersCount: number;
            membersLiteCount: number;
          };
        };
      };
    };

    team: {
      getTeamWithMembers: {
        query: { input: { organizationId: string; slug: string }; output: TeamWithMembers };
      };

      getTeamsWithMembers: {
        query: { input: { organizationId: string }; output: TeamWithMembers[] };
      };

      /** The teams list, with the people bound directly to each. */
      getTeamsWithGrants: {
        query: { input: { organizationId: string }; output: TeamWithGrants[] };
      };

      createTeamWithMembers: {
        mutation: {
          input: {
            organizationId: string;
            name: string;
            members: { userId: string; role: TeamRoleValue }[];
          };
          output: TeamReading;
        };
      };

      update: {
        mutation: {
          input: {
            teamId: string;
            name: string;
            members: { userId: string; role: TeamRoleValue }[];
          };
          output: TeamReading;
        };
      };

      archiveById: {
        mutation: { input: { teamId: string }; output: unknown };
      };
    };

    project: {
      /**
       * `teamId`/`newTeamName` are one choice — the server refuses a call
       * that names neither. The answer carries the SLUG, not the id: that is
       * the new project's address.
       */
      create: {
        mutation: {
          input: {
            organizationId: string;
            name: string;
            teamId?: string;
            newTeamName?: string;
            language: string;
            framework: string;
          };
          output: { success: boolean; projectSlug: string };
        };
      };

      /**
       * Every field but `projectId` is optional: this procedure saves the
       * whole project-settings page, and a drawer posting untouched fields
       * back would overwrite settings it never showed the reader.
       */
      update: {
        mutation: {
          input: { projectId: string; name?: string; teamId?: string };
          output: { success: boolean; projectSlug: string };
        };
      };

      archiveById: {
        mutation: { input: { projectId: string; projectToArchiveId?: string }; output: unknown };
      };
    };

    plan: {
      /**
       * `Plan` is the producer's own type (`@langwatch/entitlement-contract`),
       * not a restatement — a field the seat banner reads is a field the
       * producer promises.
       */
      getActivePlan: {
        query: { input: { organizationId: string }; output: Plan };
      };
    };

    role: {
      getAll: { query: { input: { organizationId: string }; output: CustomRoleReading[] } };
    };

    /** The grant procedures live in the authz process; the map states them from its contract. */
    authz: {
      listManagedGrants: {
        query: {
          input: AuthzListManagedBindingsForOrganizationInput;
          output: AuthzListManagedBindingsForOrganizationOutput;
        };
      };
      listMemberGrants: {
        query: {
          input: AuthzListManagedBindingsForUserInput;
          output: AuthzListManagedBindingsForUserOutput;
        };
      };
      createGrant: {
        mutation: {
          input: Omit<AuthzCreateGrantInput, "caller" | "actor">;
          output: Grant;
        };
      };
      changeGrantRole: {
        mutation: {
          input: Omit<AuthzChangeGrantRoleInput, "caller" | "actor">;
          output: Grant;
        };
      };
      revokeGrant: {
        mutation: {
          input: Omit<AuthzRevokeGrantByIdInput, "actor">;
          output: GrantRevoked;
        };
      };
      /** One save for a member's whole access sheet, so it cannot half-apply. */
      applyMemberGrants: {
        mutation: {
          input: Omit<AuthzApplyMemberBindingsInput, "caller" | "actor">;
          output: { success: true };
        };
      };
    };

    departments: {
      list: { query: { input: { organizationId: string }; output: DepartmentReading[] } };
      assignments: {
        query: { input: { organizationId: string }; output: DepartmentAssignments };
      };
      assignUser: {
        mutation: {
          input: { organizationId: string; userId: string; departmentId: string | null };
          output: unknown;
        };
      };
      assignTeam: {
        mutation: {
          input: { organizationId: string; teamId: string; departmentId: string | null };
          output: unknown;
        };
      };
      assignProject: {
        mutation: {
          input: { organizationId: string; projectId: string; departmentId: string | null };
          output: unknown;
        };
      };
    };

    joinRequests: {
      /** The post-login offer: the lookup minus the domains this person dismissed. */
      offer: { query: { input: void; output: JoinLookupDecision } };
      /** Everything this person is waiting on. */
      mine: { query: { input: void; output: JoinRequestMine } };
      dismissOffer: {
        mutation: { input: Record<string, never>; output: { success: true } };
      };
      request: {
        mutation: {
          input: { organizationId: string };
          output: { joinRequestId: string; state: "PENDING" | "APPROVED" };
        };
      };
      automaticJoins: {
        query: { input: { organizationId: string }; output: JoinRequestAutomaticJoins };
      };
      /**
       * Three settings, not a boolean: `off` refuses, `request` queues for an
       * administrator, `auto` lets them in. The domains travel with it, since
       * an organization can verify more than one.
       */
      joining: {
        query: {
          input: { organizationId: string };
          output: { domainJoin: DomainJoinSetting; joinDomains: string[] };
        };
      };
      setJoining: {
        mutation: {
          input: {
            organizationId: string;
            domainJoin: DomainJoinSetting;
            domains: string[];
          };
          output: { next: DomainJoinSetting };
        };
      };
      pending: {
        query: { input: { organizationId: string }; output: JoinRequestReading[] };
      };
      approve: {
        mutation: { input: { organizationId: string; joinRequestId: string }; output: unknown };
      };
      reject: {
        mutation: { input: { organizationId: string; joinRequestId: string }; output: unknown };
      };
    };
    /** Billing's seat expansion, borrowed until a capability offers it; mounted on SaaS. */
    subscription: {
      addTeamMemberOrEvents: {
        mutation: {
          input: {
            organizationId: string;
            plan: string;
            upgradeMembers: boolean;
            upgradeTraces: boolean;
            totalMembers: number;
            totalTraces: number;
          };
          output: unknown;
        };
      };
    };
  };

/**
 * The organization family's typed tRPC hooks. Same machinery, same transport
 * and same React Query cache as the application's `api` proxy — see
 * `createModuleApi` for why separate instances still share cache entries.
 */
export const organizationApi: ModuleApi<OrganizationApiMap> = createModuleApi<OrganizationApiMap>();

/**
 * The outputs of this map, addressed the way `RouterOutputs` was — a
 * mounted-router inference a browser package cannot name. The map is the
 * statement of what a procedure answers here; dates arrive as ISO strings.
 */
export type RouterOutputs = OutputsFromMap<OrganizationApiMap>;

/** The alias the screens moved with: `api.organization.…`, unchanged. */
export const api = organizationApi;

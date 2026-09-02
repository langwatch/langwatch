/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedures are mounted by the process out of
 * `@langwatch/organization-server`, which a web package may not import even for
 * a type, and the router type does not exist until a process instantiates one.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `organization` and `limits` are mount
 * points on the root router and tRPC hashes that path into the React Query
 * cache key; spell either differently and these hooks quietly stop sharing a
 * cache with the `api.organization.*` call sites that have not moved — of which
 * there are many, the application shell's own organization graph among them.
 *
 * `EnrichedAuditLog` IS THE PRODUCER'S OWN TYPE, not a restatement. It is
 * declared in `@langwatch/organization-contract` and `OrganizationApp.getAuditLogs`
 * is annotated with it, so widening what the audit trail answers is a compile
 * error at the producer rather than a silent disclosure at this table.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import type { Plan } from "@langwatch/entitlement-contract";
import type { EnrichedAuditLog } from "@langwatch/organization-contract";
import type { TeamRoleValue } from "../model/member-role-constraints";
import type {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "../model/prisma-types";
import { createFeatureApi } from "@langwatch/platform-api-client";

/**
 * Every filter the audit table narrows by, in the one shape both the table and
 * the CSV export send.
 *
 * The export has to send exactly this: a download taken from a pre-filtered
 * deep-link that silently widened to the whole organization's history would be
 * a disclosure dressed up as a convenience.
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

/** A team with its projects, as the teams page lists one. */
export type TeamWithProjects = TeamReading & {
  projects: TeamProjectReading[];
};

/**
 * One person's membership of a team, as the team detail form edits it.
 *
 * `role` is the stored membership and `assignedRole` the access row that
 * overrides it where one exists — the form offers the second and falls back to
 * the first, which is why both travel.
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
 * A team as the teams LIST reads it: its projects, the people bound to it
 * directly, and whether it is a project-only team.
 *
 * `directMembers` and `role` are what the list prints per row; a binding that
 * arrives through a GROUP is not a direct member and is deliberately not here.
 */
/**
 * One person's access, FLAT, as the teams list renders a row.
 *
 * The list draws people rather than joins them, so the name and the image sit
 * on the row. `viaGroupId` is what makes a row un-editable in place: a grant
 * held through a group is changed on the GROUP, and the list says so instead of
 * offering a control that would silently do something else.
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
 * One person's access to a PROJECT inside a team.
 *
 * `source` is the whole reason a project row expands: `team` means the grant is
 * inherited from the team and is read-only here, and `override` means it was
 * set on the project itself and can be changed or removed. `teamRole` is what
 * the override is overriding, which is what makes the difference legible.
 */
export type ProjectAccessRow = TeamAccessRow & {
  source: "team" | "override" | "group";
  teamRole?: TeamRoleValue | null;
  bindingId?: string | null;
};

export type TeamWithRoleBindings = TeamWithProjects & {
  /**
   * People who reach a PROJECT of this team without being on the team.
   *
   * The list shows them under the team because that is where a reader looks
   * for "who can see this", and names the project each one reaches.
   */
  projectOnlyAccess: Array<TeamAccessRow & { projectName: string }>;
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
  disabledAt: Date | null;
  customRoleId?: string | null;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image?: string | null;
    pendingSince?: Date | null;
    /** When the ACCOUNT was deactivated, which outlives one organization. */
    deactivatedAt?: Date | null;
  };
  teamMemberships?: Array<{ teamId: string; role: TeamUserRole; team: { name: string } }>;
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
   * What the table actually prints, which is not always `status`.
   *
   * An invitation past its expiry is still `PENDING` in the row and EXPIRED to
   * a reader, and the difference decides whether "resend" is offered.
   */
  displayStatus: string;
  inviteCode: string;
  expiration: Date;
  teamIds: string;
};

/** An access rule: a role held at a scope, by a person or through a group. */
export type RoleBindingReading = {
  id: string;
  userId: string;
  role: TeamRoleValue;
  customRoleId?: string | null;
  customRoleName?: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  scopeName?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  /**
   * Everybody a GROUP binding reaches.
   *
   * A binding held by a group grants to every member of it, and the members
   * table has to attribute those grants to the people who hold them — which is
   * why the row carries the ids rather than the table joining for them.
   */
  memberUserIds: string[];
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
 * Which department each team, project and person has been assigned to.
 *
 * One department per entity, which is why the value is an id and not a list:
 * the picker is a single select and the column prints one chip.
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
 * A request to join this organization, waiting on an administrator.
 *
 * The DOMAIN is on the row rather than derived from the address: what the table
 * says is "somebody at this verified domain asked to join", and an organization
 * can verify more than one.
 */
export type JoinRequestReading = {
  joinRequestId: string;
  email: string;
  name: string | null;
  domain: string;
  requestedAt: Date;
  expiresAt: Date;
};

export type OrganizationApiMap = {
  organization: {
    /**
     * One page of the organization's audit trail, newest first.
     *
     * `pageOffset`/`pageSize` are real offset paging — the audit trail is a
     * Prisma read with `skip`, not a keyset walk — which is why the footer this
     * screen renders drives its own offsets rather than carrying a cursor.
     */
    getAuditLogs: {
      query: {
        input: AuditLogFilters & { pageOffset: number; pageSize: number };
        output: AuditLogPage;
      };
    };

    /**
     * The organization graph the application shell already holds.
     *
     * Asked by the FRONTEND FEATURE rather than by the screen — the screen is
     * handed the teams and projects through its host port — and declared here
     * because that feature runs on this package's transport. Same input the
     * shell asks with, so under tRPC's path-plus-input cache key it is the same
     * entry: the graph is fetched once for the document.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: Array<{
          id: string;
          name: string;
          slug: string;
          teams: Array<{
            id: string;
            name: string;
            slug: string;
            projects: Array<{ id: string; name: string; slug: string }>;
          }>;
        }>;
      };
    };

    /**
     * Every member of the organization, with the teams each of them is on.
     *
     * ONE PROCEDURE, TWO READERS, and the shape is the union of what both
     * need: the audit page's "search by user" box matches a typed name against
     * it, and the members page renders the whole table off it. The audit page
     * reads `members[].user`, which is why `OrganizationMemberMatch` is still
     * exported — it is the narrower view of the same row.
     */
    getOrganizationWithMembersAndTheirTeams: {
      query: {
        input: { organizationId: string; includeDeactivated?: boolean };
        output: OrganizationWithMembersAndTheirTeams;
      };
    };

    /** The same list, flat, for the pickers that only need names. */
    getAllOrganizationMembers: {
      query: {
        input: { organizationId: string };
        output: OrganizationMemberWithTeams[];
      };
    };

    getOrganizationPendingInvites: {
      query: { input: { organizationId: string }; output: OrganizationInviteReading[] };
    };

    /**
     * One invitation per row of the form, sent in one call.
     *
     * ONE RESULT PER INVITE, and `emailNotSent` is the field the members page
     * turns on: a deployment with no mail provider still CREATES the invitation
     * and hands back a link to send by hand, which is why this is a per-row
     * flag rather than a failure.
     */
    createInvites: {
      mutation: {
        input: {
          organizationId: string;
          invites: Array<{
            email: string;
            role: OrganizationUserRole;
            teams?: Array<{ teamId: string; role: TeamRoleValue; customRoleId?: string | null }>;
          }>;
        };
        output: Array<{
          invite: OrganizationInviteReading;
          emailNotSent?: boolean;
        } | null>;
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
         * The teams this change would leave with nobody able to administer them.
         *
         * Named rather than counted, because the dialog lists them: a warning
         * that says "three teams" and not which three is one an administrator
         * cannot act on.
         */
        output: { teamsLeftWithoutAdmin?: Array<{ id: string; name: string }> };
      };
    };
  };

  limits: {
    /**
     * What this organization has used, against what it may use.
     *
     * TWO READERS, ONE ENTRY: the audit page's Enterprise gate reads
     * `activePlan.type`, and the seat meter beside the members table reads the
     * two counts. Same procedure, same cache key, one round trip.
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
    getTeamsWithRoleBindings: {
      query: { input: { organizationId: string }; output: TeamWithRoleBindings[] };
    };

    createTeamWithMembers: {
      mutation: {
        input: {
          organizationId: string;
          name: string;
          members: Array<{ userId: string; role: TeamRoleValue }>;
        };
        output: TeamReading;
      };
    };

    update: {
      mutation: {
        input: {
          teamId: string;
          name: string;
          members: Array<{ userId: string; role: TeamRoleValue }>;
        };
        output: TeamReading;
      };
    };

    archiveById: {
      mutation: { input: { teamId: string }; output: unknown };
    };
  };

  project: {
    archiveById: {
      mutation: { input: { projectId: string; projectToArchiveId?: string }; output: unknown };
    };
  };

  plan: {
    /**
     * The plan this organization is on.
     *
     * THE PRODUCER'S OWN TYPE, not a restatement: `Plan` is declared in
     * `@langwatch/entitlement-contract` and the plan provider is annotated with
     * it, so a field the seat banner reads is a field the producer promises.
     */
    getActivePlan: {
      query: { input: { organizationId: string }; output: Plan };
    };
  };

  licenseEnforcement: {
    /**
     * Whether one more of something is within the licence.
     *
     * Answered optimistically while it is still arriving — the write enforces
     * the limit again — and invalidated by every page here that frees a seat.
     */
    checkLimit: {
      query: {
        input: { organizationId: string; limitType?: string };
        output: { allowed: boolean; current: number; max: number };
      };
    };

    /** Fire-and-forget: a UI pre-check refused somebody, so somebody wanted more. */
    reportLimitBlocked: {
      mutation: {
        input: {
          organizationId: string;
          limitType: string;
          current?: number;
          max?: number;
        };
        output: unknown;
      };
    };
  };

  role: {
    getAll: { query: { input: { organizationId: string }; output: CustomRoleReading[] } };
  };

  roleBinding: {
    listForOrg: {
      query: { input: { organizationId: string }; output: RoleBindingReading[] };
    };
    listForUser: {
      query: {
        input: { organizationId: string; userId: string };
        output: RoleBindingReading[];
      };
    };
    create: {
      mutation: {
        input: {
          organizationId: string;
          userId: string;
          role: TeamRoleValue;
          customRoleId?: string | null;
          scopeType: RoleBindingScopeType;
          scopeId: string;
        };
        output: unknown;
      };
    };
    update: {
      mutation: {
        input: {
          organizationId: string;
          bindingId: string;
          role: TeamRoleValue;
          customRoleId?: string | null;
        };
        output: unknown;
      };
    };
    delete: {
      mutation: { input: { organizationId: string; bindingId: string }; output: unknown };
    };
    /** One save for a member's whole access sheet, so it cannot half-apply. */
    applyMemberBindings: {
      mutation: {
        input: {
          organizationId: string;
          userId: string;
          /** The rows that stay, with whatever role they now hold. */
          bindings?: Array<{
            id?: string;
            role: TeamRoleValue;
            customRoleId?: string | null;
            scopeType: RoleBindingScopeType;
            scopeId: string;
          }>;
          /** The rows the sheet added, which have no id yet. */
          bindingsToCreate?: Array<{
            role: TeamRoleValue;
            customRoleId?: string | null;
            scopeType: RoleBindingScopeType;
            scopeId: string;
          }>;
          bindingIdsToDelete?: string[];
        };
        output: unknown;
      };
    };
  };

  group: {
    listAll: {
      query: {
        input: { organizationId: string };
        output: Array<{
          id: string;
          name: string;
          scimSource: string | null;
          memberCount: number;
          bindings: Array<{
            role: TeamRoleValue;
            customRoleName?: string | null;
            scopeType: RoleBindingScopeType;
            scopeId: string;
            scopeName?: string | null;
          }>;
        }>;
      };
    };
    /** The groups one person is in, and what each of them grants. */
    listForMember: {
      query: {
        input: { organizationId: string; userId: string };
        output: Array<{
          id: string;
          name: string;
          bindings: Array<{
            id: string;
            role: TeamRoleValue;
            customRoleName?: string | null;
            scopeType: RoleBindingScopeType;
            scopeId: string;
            scopeName?: string | null;
          }>;
        }>;
      };
    };
    getById: {
      query: {
        input: { organizationId: string; groupId: string };
        output: {
          id: string;
          name: string;
          scimSource: string | null;
          members: Array<{
            userId: string;
            name: string | null;
            email: string | null;
            image?: string | null;
          }>;
          bindings: Array<{
            id: string;
            role: TeamRoleValue;
            customRoleId?: string | null;
            customRoleName?: string | null;
            scopeType: RoleBindingScopeType;
            scopeId: string;
            scopeName?: string | null;
          }>;
        };
      };
    };
    /** A new group, with whatever access rules were sketched in the dialog. */
    create: {
      mutation: {
        input: {
          organizationId: string;
          name: string;
          memberIds?: string[];
          bindings?: Array<{
            role: TeamRoleValue;
            customRoleId?: string | null;
            scopeType: RoleBindingScopeType;
            scopeId: string;
          }>;
        };
        output: { id: string };
      };
    };
    delete: {
      mutation: { input: { organizationId: string; groupId: string }; output: unknown };
    };
    addBinding: {
      mutation: {
        input: {
          organizationId: string;
          groupId: string;
          role: TeamRoleValue;
          customRoleId?: string | null;
          scopeType: RoleBindingScopeType;
          scopeId: string;
        };
        output: unknown;
      };
    };
    /** One save for a group's whole sheet — name, members and bindings. */
    applyEdits: {
      mutation: {
        input: {
          organizationId: string;
          groupId: string;
          /** Null when the name was not touched, which is not the same as "". */
          rename?: { name: string } | null;
          bindingIdsToDelete: string[];
          /** The rows the sheet added, which have no id yet. */
          bindingsToCreate: Array<{
            role: TeamRoleValue;
            customRoleId?: string | null;
            scopeType: RoleBindingScopeType;
            scopeId: string;
          }>;
          memberUserIdsToAdd: string[];
          memberUserIdsToRemove: string[];
        };
        output: unknown;
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
    /**
     * How this organization treats somebody arriving from a verified domain.
     *
     * Three settings and not a boolean: `off` refuses them, `request` queues
     * them for an administrator, and `auto` lets them in. The domains it
     * applies to travel with it, because an organization can verify more than
     * one and the setting is meaningless without knowing which.
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
};

/**
 * The organization family's typed tRPC hooks. Same machinery, same transport
 * and same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 */
export const organizationApi = createFeatureApi<OrganizationApiMap>();

/**
 * The outputs of this map, addressed the way `RouterOutputs` was.
 *
 * `platform/app`'s `RouterOutputs` was inferred from the mounted router, which
 * a browser package cannot name. Screens that wrote
 * `RouterOutputs["group"]["listAll"][number]` keep that line by reading the
 * same shape off the declaration below instead — the map IS the statement of
 * what a procedure answers here.
 */
type OutputsOf<TMap> = {
  [K in keyof TMap]: TMap[K] extends { query: { output: infer O } }
    ? O
    : TMap[K] extends { mutation: { output: infer O } }
      ? O
      : OutputsOf<TMap[K]>;
};

export type RouterOutputs = OutputsOf<OrganizationApiMap>;

/** The alias the screens moved with: `api.organization.…`, unchanged. */
export const api = organizationApi;

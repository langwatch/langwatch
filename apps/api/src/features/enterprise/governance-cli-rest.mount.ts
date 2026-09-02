/**
 * The API process's CLI governance door.
 *
 * Behaviour is package-owned (`@langwatch/enterprise-governance-server`); this
 * supplies what the thirteen routes reach that governance does not own — the
 * device session a bearer names, the directory the membership is re-derived
 * from, the personal workspace, the plan the Enterprise gate reads, and the
 * two RBAC decisions.
 *
 * ## Why the bearer reader is a port rather than an import
 *
 * `/api/auth/cli` is two families by two owners: the RFC 8628 device grant
 * WRITES the session tokens and lives in `@langwatch/auth-server`, and these
 * thirteen READ one. Binding the reader here — to the same
 * `CliDeviceSessionService` the grant mints through — is what keeps a single
 * implementation of the keyspace while leaving the two packages independent.
 * A second reader spelled from either side would be a second keyspace, and
 * the failure is silent: tokens keep working and the sessions simply stop
 * being found.
 *
 * ## Named absences
 *
 * - **The whole family is absent without an Enterprise application.** These
 *   routes ARE Enterprise governance; a deployment that composed none would be
 *   answering 500 to every `langwatch claude` pre-flight, which is worse than
 *   a 404 from a door that plainly is not here.
 * - **The budget pre-flight has no spend store on this process.** The gateway
 *   group is what holds the spend decisions, and where it is absent the
 *   pre-flight answers `{ok: true}`: the gateway itself still surfaces the
 *   real block on the first request through the same code path. That is the
 *   documented degradation for installs running no spend store, not a new one.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type {
  GovernanceCliAccessTokenPort,
  GovernanceCliBudgetPort,
  GovernanceCliPersonalWorkspace,
  GovernanceCliRestPorts,
} from "@langwatch/enterprise-governance-server";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { OrganizationApp } from "@langwatch/organization-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

export type ApiGovernanceCliRestOptions = Readonly<{
  /** The Enterprise governance capability, where the deployment composed one. */
  governance: GovernanceService | undefined;
  /** The device session a bearer names, as this process reads one. */
  accessTokens: GovernanceCliAccessTokenPort | undefined;
  /** The process's one guarded connection, or none. */
  prisma: PrismaClient | undefined;
  /** The organization application the personal workspace is resolved on. */
  organizations: OrganizationApp | undefined;
  /** Which plan an organization is on, for the Enterprise gate. */
  plans: PlanProvider | undefined;
  /** The AuthZ graph both RBAC checks run on. */
  authz: AuthzService | undefined;
  /** The spend decision the budget pre-flight asks, where one is composed. */
  budgets: GovernanceCliBudgetPort | undefined;
  /** This deployment's public origin, where it declared one. */
  publicBaseUrl: string | undefined;
}>;

/**
 * Composes the CLI governance ports, or none.
 *
 * Absent without any one of the governance capability, the bearer reader, the
 * database, the organization application, the plan provider or AuthZ. Each is
 * load-bearing for a refusal rather than for a read: without the plan there is
 * no Enterprise gate and the routes would answer Enterprise data to a free
 * tenant; without AuthZ there is no permission check and any member could read
 * every ingestion source in the organization.
 */
export function composeApiGovernanceCliRest(
  options: ApiGovernanceCliRestOptions,
): GovernanceCliRestPorts | undefined {
  const { governance, accessTokens, prisma, organizations, plans, authz } = options;
  if (!governance || !accessTokens || !prisma || !organizations || !plans || !authz) {
    return undefined;
  }

  const ensurePersonalWorkspace = async (input: {
    organizationId: string;
    userId: string;
    displayName?: string | null;
    displayEmail?: string | null;
  }): Promise<GovernanceCliPersonalWorkspace> =>
    (await organizations.ensurePersonalWorkspace(
      {
        organizationId: input.organizationId,
        displayName: input.displayName,
        displayEmail: input.displayEmail,
      },
      { id: input.userId },
    )) as GovernanceCliPersonalWorkspace;

  const tryFindPersonalWorkspace = async (input: {
    organizationId: string;
    userId: string;
  }): Promise<GovernanceCliPersonalWorkspace | null> =>
    (await organizations.tryFindPersonalWorkspace(
      { organizationId: input.organizationId },
      { id: input.userId },
    )) as GovernanceCliPersonalWorkspace | null;

  return {
    accessTokens,
    governance: () => governance,
    database: () => prisma,
    ensurePersonalWorkspace,
    tryFindPersonalWorkspace,
    plans: () => plans,
    permittedOnOrganization: ({ userId, organizationId, permission }) =>
      authz.hasPermission({ userId, permission, organizationId }),
    permittedOnProject: ({ userId, projectId, permission }) =>
      authz.hasPermission({ userId, permission, projectId }),
    ...(options.budgets ? { budgets: options.budgets } : {}),
    ...(options.publicBaseUrl ? { publicBaseUrl: options.publicBaseUrl } : {}),
  };
}

/**
 * The SCIM 2.0 directory-sync application this process serves the fifteen
 * `/api/scim/v2/**` routes and the Auth0 intake from.
 */
import type { AuthService } from "@langwatch/auth-contract";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import {
  PostgresScimAdapter,
  ScimSyncLifecycleAdapter,
  type ScimService,
} from "@langwatch/enterprise-api";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  newScimSyncCommandId,
  PrismaScimSyncProjectionRepository,
  ScimSyncGuards,
  ScimSyncLedgerWriterAdapter,
  type IdentityEventingPort,
} from "@langwatch/identity-server";
import type { Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { UserService } from "@langwatch/user-contract";

/**
 * Everything the two SCIM REST families reach that they do not own.
 */
export type ApiScimRestPorts = Readonly<{
  /**
   * The directory-sync service the fifteen protocol routes read.
   */
  scim: () => ScimService;
  /**
   * The shared secret Auth0 presents on its log stream, or none.
   */
  webhookSecret: () => string | undefined;
}>;

/** Reports the composition decision an absent collaborator would otherwise hide. */
export abstract class ApiScimAbsenceReport {
  /**
   * The family is not mounted, and which collaborator decided that.
   */
  abstract absent(because: string): void;
}

/** Names the absent collaborator once, on the process's own logger. */
export class LoggedApiScimAbsence extends ApiScimAbsenceReport {
  static create(logger: Logger): LoggedApiScimAbsence {
    return new LoggedApiScimAbsence(logger);
  }

  private constructor(private readonly logger: Logger) {
    super();
  }

  absent(because: string): void {
    this.logger.info(
      { family: "scim" },
      `SCIM 2.0 provisioning is not served: this process composed no ${because}`,
    );
  }
}

export type ApiScimCompositionOptions = Readonly<{
  /** The one guarded connection every row below is read and written on. */
  prisma: PrismaClient | undefined;
  /** The grant ledger a directory push's membership consequence is written to. */
  grants: AuthzGrantsService | undefined;
  /** The user directory the members screen and the invitation write through. */
  users: UserService | undefined;
  /** The session boundary a SCIM-managed email change severs. */
  auth: AuthService | undefined;
  /** Enterprise governance's department owner, and this family's whole gate. */
  governance: GovernanceService | undefined;
  /** The ONE plan provider every Enterprise gate on this process reads. */
  plans: PlanProvider | undefined;
  /**
   * The event stack the directory-sync history is appended and staged through.
   */
  eventing: IdentityEventingPort | undefined;
  /** D08's `SCIM_V2_GRANTS`: whether a deactivation revokes grants first. */
  provenOffboarding: boolean;
  /** The shared secret Auth0 presents, where this deployment configured one. */
  auth0WebhookSecret: string | undefined;
  report?: ApiScimAbsenceReport | undefined;
}>;

/**
 * Composes the two SCIM families' ports, or none. Absent without any one of the seven
 * collaborators, and the report says which.
 */
export function composeApiScimRest(
  options: ApiScimCompositionOptions,
): ApiScimRestPorts | undefined {
  const { prisma, grants, users, auth, governance, plans, eventing } = options;
  if (!prisma) return absent(options, "database connection");
  if (!grants) return absent(options, "AuthZ grant ledger");
  if (!users) return absent(options, "user directory");
  if (!auth) return absent(options, "browser-session boundary");
  if (!governance) return absent(options, "Enterprise governance application");
  if (!plans) return absent(options, "plan provider");
  if (!eventing) return absent(options, "identity event stack");

  const scim = PostgresScimAdapter.create({
    database: prisma,
    writer: grants,
    users,
    auth,
    governance,
    entitlements: plans,
    lifecycle: ScimSyncLifecycleAdapter.create({
      guards: new ScimSyncGuards({ syncs: new PrismaScimSyncProjectionRepository(prisma) }),
      ledger: ScimSyncLedgerWriterAdapter.create({ eventing }),
      newCommandId: newScimSyncCommandId,
    }),
    provenOffboarding: options.provenOffboarding,
  }).build();

  return {
    scim: () => scim,
    webhookSecret: () => options.auth0WebhookSecret,
  };
}

/**
 * Names the collaborator that decided the family is not here, and leaves. The FIRST one
 * rather than all of them: a deployment missing the Enterprise application is missing
 * exactly one thing, and listing seven absences for one cause reads as seven problems.
 */
function absent(options: ApiScimCompositionOptions, because: string): undefined {
  options.report?.absent(because);
  return undefined;
}

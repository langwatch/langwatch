/**
 * The SCIM 2.0 directory-sync application this process serves the fifteen
 * `/api/scim/v2/**` routes, the `/api/scim-tokens` management family and the
 * Auth0 intake from. One installation, four declared doors.
 */
import type { AppRestManagementAuditPort } from "@langwatch/api/rest";
import type { AuthService } from "@langwatch/auth-contract";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import {
  PostgresScimAdapter,
  ScimSyncLifecycleAdapter,
  scimServer,
  type ScimApi,
  type ScimInfrastructure,
} from "@langwatch/enterprise-api";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  newScimSyncCommandId,
  PrismaScimSyncProjectionRepository,
  ScimSyncGuardsService,
  ScimSyncLedgerWriterAdapter,
  type IdentityEventingPort,
} from "@langwatch/identity-server";
import type { Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp } from "@langwatch/runtime-composition";
import type { UserService } from "@langwatch/user-contract";

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
  /** Where minting and revoking a token are recorded, as the process writes it. */
  managementAudit: AppRestManagementAuditPort;
  /** D08's `SCIM_V2_GRANTS`: whether a deactivation revokes grants first. */
  provenOffboarding: boolean;
  /** The shared secret Auth0 presents, where this deployment configured one. */
  auth0WebhookSecret: string | undefined;
  report?: ApiScimAbsenceReport | undefined;
}>;

/**
 * Installs the SCIM feature over this process's own graph, or nothing. Absent without any
 * one of the seven collaborators, and the report says which.
 */
export async function installApiScim(
  options: ApiScimCompositionOptions,
): Promise<ScimApi | undefined> {
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
      guards: ScimSyncGuardsService.create({
        syncs: new PrismaScimSyncProjectionRepository(prisma),
      }),
      ledger: ScimSyncLedgerWriterAdapter.create({ eventing }),
      newCommandId: newScimSyncCommandId,
    }),
    provenOffboarding: options.provenOffboarding,
  }).build();

  const infrastructure: ScimInfrastructure = {
    scim,
    planProvider: { getActivePlan: (input) => plans.getActivePlan(input) },
    // A function rather than a value, so a rotation without a restart works,
    // and its absence is what makes the intake answer 404 rather than 401.
    webhookSecret: () => options.auth0WebhookSecret,
    managementAudit: options.managementAudit,
  };
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure(infrastructure)
    .withFeature(scimServer)
    .boot({ role: "api" });

  return runtime.feature(scimServer).provided;
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

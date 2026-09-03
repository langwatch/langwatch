/**
 * The SCIM 2.0 directory-sync application this process serves the fifteen
 * `/api/scim/v2/**` routes and the Auth0 intake from.
 *
 * The routes were published for a year and answered by nothing: the mountable
 * apps moved into `@langwatch/enterprise-scim-server` with REST wave 3a and no
 * process named them, so an identity provider following the frozen OpenAPI
 * document reached a 404 on every operation. Everything the service is built
 * from was already here — this is the composition that says so.
 *
 * ## Where each collaborator comes from
 *
 *   prisma        the process's one guarded connection: the tokens, the
 *                 memberships, the groups and the directory's own external ids
 *   grants        the AuthZ grant ledger, which is where a directory push's
 *                 membership consequence is actually written
 *   users         the identity half's user directory — the same one the
 *                 members screen and the invitation acceptance write through
 *   auth          the browser-session boundary, for the session severance a
 *                 SCIM-managed email change forces
 *   governance    Enterprise governance's department owner, for the cost
 *                 centre a directory pushes as a user attribute
 *   plans         the ONE plan provider every Enterprise gate on this process
 *                 reads; `verifyToken` is where a token for an unentitled
 *                 organization becomes a 403 rather than a 401
 *   lifecycle     the directory-sync history, stated over identity's own
 *                 guards and ledger writer (see below)
 *
 * ## The Enterprise gate is `governance`, and that is deliberate
 *
 * SCIM is an Enterprise capability, and the only collaborator above that a
 * core deployment cannot hold is the department owner — it arrives on
 * `ApiEnterpriseApplicationPort.governance`. So a deployment that composed the
 * Enterprise application serves the family and one that did not leaves it off
 * and is told which collaborator was missing. That is a stronger gate than a
 * boolean: it cannot be true while the graph underneath it is half-built.
 *
 * Mounting the family over a refusing service would be worse than the 404 it
 * replaces — an identity provider's nightly provisioning run would see fifteen
 * endpoints answering 500 and retry them forever.
 *
 * ## The directory-sync history degrades, and this is why
 *
 * `ScimSyncLifecycle` states what a push did on the connection's `ScimSync`
 * aggregate. Its guards are REAL here — they read the Postgres projection head
 * this process's connection already holds — and so is the ledger writer, which
 * stages its command and lets the queued run append (ADR-110). What this
 * process does not do is REGISTER `scim-sync` on its eventing, so there is no
 * sender to stage through: the writer says so at `error`, naming the missing
 * pipeline, and lets the push through. Every directory-sync fact is therefore
 * lost on this deployment for as long as that holds — not transiently, and not
 * because an event stack is down.
 *
 * That is a smaller and sharper absence than the one this docblock used to
 * name. The writer no longer attempts a durable append it could never
 * complete; what is left is one registration. The worker already registers and
 * drains the consumer side unconditionally
 * (`ScimSyncWorkerFeatureInstaller`), so closing it means adding a producer
 * variant of the directory-sync pipeline beside the three
 * `api-identity-pipelines.composition.ts` registers.
 *
 * What the customer is owed either way is the membership consequence, which
 * travels the grants ledger and is durable before the history is attempted.
 * Supplying a hand-written no-op ledger instead would hide the same fact
 * behind a stub that starts lying the day the registration lands.
 */
import type { AuthService } from "@langwatch/auth-contract";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import {
  PostgresScimAdapter,
  ScimSyncLifecycle,
  type ScimService,
} from "@langwatch/enterprise-api";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  newScimSyncCommandId,
  PrismaScimSyncProjectionRepository,
  ScimSyncGuards,
  ScimSyncLedgerWriter,
  type IdentityEventingPort,
} from "@langwatch/identity-server";
import type { Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { UserService } from "@langwatch/user-contract";

/**
 * Everything the two SCIM REST families reach that they do not own.
 *
 * One entry rather than two because they are one surface: the protocol routes
 * and the Auth0 intake provision through the SAME service, and a process that
 * held one and not the other would let a directory create a member on one door
 * that the other cannot see.
 */
export type ApiScimRestPorts = Readonly<{
  /**
   * The directory-sync service the fifteen protocol routes read.
   *
   * A provider rather than a value for the reason every other family's is:
   * mounting a family must not force its service to be constructed, which is
   * what lets the OpenAPI description build this app over a stand-in.
   */
  scim: () => ScimService;
  /**
   * The shared secret Auth0 presents on its log stream, or none.
   *
   * A function, and its absence is a 404 rather than a 401 — the intake's own
   * rule, and the reason it is passed through rather than gated on here: an
   * install that configured no secret has no webhook, and answering 401 would
   * confirm the path exists to anyone who probed it.
   */
  webhookSecret: () => string | undefined;
}>;

/** Reports the composition decision an absent collaborator would otherwise hide. */
export abstract class ApiScimAbsenceReport {
  /**
   * The family is not mounted, and which collaborator decided that.
   *
   * Named at boot rather than at the first request: an identity provider's
   * provisioning run fails silently against a 404, and the operator reading
   * this line is the only person who can tell it apart from a URL typo.
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
   *
   * The identity half's OWN adapter, never a second one: it resolves command
   * senders out of this process's producer registrations, and a second
   * registry would answer `null` for every command the first one holds.
   */
  eventing: IdentityEventingPort | undefined;
  /** D08's `SCIM_V2_GRANTS`: whether a deactivation revokes grants first. */
  provenOffboarding: boolean;
  /** The shared secret Auth0 presents, where this deployment configured one. */
  auth0WebhookSecret: string | undefined;
  report?: ApiScimAbsenceReport | undefined;
}>;

/**
 * Composes the two SCIM families' ports, or none.
 *
 * Absent without any one of the seven collaborators, and the report says which.
 * Each is load-bearing for a REFUSAL rather than for a read: without the plan
 * provider there is no entitlement check and a token minted before a downgrade
 * would keep provisioning; without the grant ledger a member would be created
 * with no organization binding, which reads to the customer as a person who
 * signed in and can see nothing.
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
    lifecycle: ScimSyncLifecycle.create({
      guards: new ScimSyncGuards({ syncs: new PrismaScimSyncProjectionRepository(prisma) }),
      ledger: new ScimSyncLedgerWriter({ eventing }),
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
 * Names the collaborator that decided the family is not here, and leaves.
 *
 * The FIRST one rather than all of them: a deployment missing the Enterprise
 * application is missing exactly one thing, and listing seven absences for one
 * cause reads as seven problems.
 */
function absent(options: ApiScimCompositionOptions, because: string): undefined {
  options.report?.absent(because);
  return undefined;
}

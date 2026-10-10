import type { LedgerActor } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  OpsImpersonatedOperatorRefusedError,
  OpsOperatorSessionRequiredError,
  PlatformOperatorUserNotFoundError,
  type OpsOperator,
  type OpsPlatformOperator,
} from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { type UserApi, UserEmailAmbiguousError, type UserProfile } from "@langwatch/user-contract";

const logger = createLogger("langwatch:ops:platform-operators");

/** The ledger actor on the one-time seed's grants. */
export const PLATFORM_OPERATOR_SEED_ACTOR: LedgerActor = {
  type: "system",
  id: "system:ops-platform-operator-seed",
};

/** The ledger actor on the recovery task's grants: shell access already implies full control. */
export const PLATFORM_OPERATOR_TASK_ACTOR: LedgerActor = {
  type: "system",
  id: "system:grant-platform-operator-task",
};

const RECOVERY_HINT =
  "run `pnpm --filter @langwatch/tasks task grant-platform-operator <email>` to grant one";

/** What the seed reads: the address list, and whether this is the hosted service. */
export type PlatformOperatorSeedSettings = Readonly<{
  adminEmails: readonly string[];
  cloud: boolean;
}>;

/** Who the one-time seed decides to grant, and why. `waiting`: nothing decided, nothing latched. */
export type PlatformOperatorSeedOutcome = Readonly<{
  via: "waiting" | "admin-emails" | "sole-organization-admin" | "none";
  userIds: readonly string[];
  reason: string;
}>;

/** Sends ops's own record-the-seed command; the event latches the seed process's marker. */
type PlatformOperatorSeedRecorder = Readonly<{
  record(outcome: {
    via: Exclude<PlatformOperatorSeedOutcome["via"], "waiting">;
    userIds: readonly string[];
  }): Promise<void>;
}>;

type PlatformOperatorsServiceOptions = Readonly<{
  authz: Pick<
    AuthzApi,
    "grantPlatformOperator" | "revokePlatformOperator" | "listPlatformOperators"
  >;
  users: Pick<UserApi, "findByEmail" | "findById" | "countUsage">;
  organizations: Pick<OrganizationApi, "listProvisioningSummaries" | "findAdministrators">;
  /** No email at all: no account here can verify its address, so the seed cannot ask for it. */
  emailIsUnconfigured: () => Promise<boolean>;
}>;

/**
 * ops's side of the platform-operator grant (ARCHITECTURE.md, "Platform operators are a grant"
 * and "Operator bootstrap"): the Operators page, the recovery task and the one-time seed. authz
 * holds the rules (no self-grant, last holder); this resolves people and picks the seed.
 */
export class PlatformOperatorsService {
  private constructor(private readonly options: PlatformOperatorsServiceOptions) {}

  static create(options: PlatformOperatorsServiceOptions): PlatformOperatorsService {
    return new PlatformOperatorsService(options);
  }

  #recorder: PlatformOperatorSeedRecorder | undefined;
  #namedUserWaitLogged = false;

  /** Bound once ops's pipeline registers, as the system-migration kick is. */
  connectSeedRecorder(recorder: PlatformOperatorSeedRecorder): void {
    this.#recorder = recorder;
  }

  async list(): Promise<OpsPlatformOperator[]> {
    const holders = await this.options.authz.listPlatformOperators();
    return Promise.all(
      holders.map(async (holder) => {
        const user = await this.options.users.findById({ id: holder.userId });
        return { ...holder, name: user?.name ?? null, email: user?.email ?? null };
      }),
    );
  }

  /** A signed-in, non-impersonated operator grants; authz refuses granting yourself. */
  async grant({
    email,
    operator,
  }: {
    email: string;
    operator: OpsOperator | null;
  }): Promise<OpsPlatformOperator> {
    const granter = signedInOperator(operator);
    const user = await this.#activeUserOf(email);
    // The page never grants an unclaimed address: whoever registered it first would operate.
    if (!user.emailVerified) throw new PlatformOperatorUserNotFoundError({ userId: user.id });
    const held = await this.options.authz.grantPlatformOperator({
      principal: { type: "user", id: user.id },
      caller: { type: "user", id: granter.id },
      actor: { type: "user", id: granter.id },
      source: "grants-service",
    });
    return { ...held, name: user.name, email: user.email };
  }

  async revoke({
    grantId,
    operator,
  }: {
    grantId: string;
    operator: OpsOperator | null;
  }): Promise<void> {
    const revoker = signedInOperator(operator);
    await this.options.authz.revokePlatformOperator({
      grantId,
      caller: { type: "user", id: revoker.id },
      actor: { type: "user", id: revoker.id },
    });
  }

  /** The recovery task: lockout on self-hosted, staff at the cloud cutover. */
  async grantAsSystem({ email }: { email: string }): Promise<OpsPlatformOperator> {
    const user = await this.#activeUserOf(email);
    const held = await this.options.authz.grantPlatformOperator({
      principal: { type: "user", id: user.id },
      caller: { type: "system" },
      actor: PLATFORM_OPERATOR_TASK_ACTOR,
      source: "grants-service",
    });
    return { ...held, name: user.name, email: user.email };
  }

  /**
   * One seed attempt: decide, then record the decision, which latches the marker. It grants
   * nothing itself: the recorded event asks for the grants, so a failed record grants nobody
   * and only the first recorded decision is ever granted (review L2). Waiting records nothing.
   */
  async seedOnce(settings: PlatformOperatorSeedSettings): Promise<PlatformOperatorSeedOutcome> {
    const outcome = await this.#decide(settings);
    if (outcome.via === "waiting") return outcome;
    if (!this.#recorder) {
      throw new Error(
        "the platform-operator seed ran in a process that never connected its command",
      );
    }
    await this.#recorder.record({ via: outcome.via, userIds: outcome.userIds });
    return outcome;
  }

  /** The recorded decision's grants, as the system; authz keeps a holder's existing grant. */
  async grantSeeded({
    via,
    userIds,
  }: Parameters<PlatformOperatorSeedRecorder["record"]>[0]): Promise<void> {
    for (const id of userIds) {
      await this.options.authz.grantPlatformOperator({
        principal: { type: "user", id },
        caller: { type: "system" },
        actor: PLATFORM_OPERATOR_SEED_ACTOR,
        source: "migration",
      });
    }
    logger.info({ via, userIds }, "seeded the platform operators once");
  }

  /**
   * The `ops:seed-platform-operators` upgrade step: while nobody holds the grant, grants the
   * verified active users a still-set ADMIN_EMAILS names, and answers how many. Anything else (no
   * named user yet, no ADMIN_EMAILS, the hosted service) stays with the seed process's wait.
   */
  async seedFromAdminEmails({
    settings,
    dryRun,
  }: {
    settings: PlatformOperatorSeedSettings;
    dryRun: boolean;
  }): Promise<number> {
    if (settings.cloud || settings.adminEmails.length === 0) return 0;
    if ((await this.options.authz.listPlatformOperators()).length > 0) return 0;
    const named = await this.#seedableUsersNamed(settings.adminEmails);
    if (!dryRun && named.length > 0)
      await this.grantSeeded({ via: "admin-emails", userIds: named });
    return named.length;
  }

  /**
   * Cloud never seeds; no user waits; existing holders decide nobody. A set ADMIN_EMAILS takes its
   * verified active users or waits, never an org admin. An empty one takes the only organization's
   * oldest active admin, waits with no organization, and decides nobody with several.
   */
  async #decide({
    adminEmails,
    cloud,
  }: PlatformOperatorSeedSettings): Promise<PlatformOperatorSeedOutcome> {
    if (cloud) return nobody("the hosted service never bootstraps; staff are granted by the task");
    if (!(await this.#anyUserExists())) return waiting("no user exists yet");
    if ((await this.options.authz.listPlatformOperators()).length > 0) {
      return nobody("platform operators already hold the grant");
    }

    if (adminEmails.length > 0) {
      const named = await this.#seedableUsersNamed(adminEmails);
      if (named.length > 0) {
        return { via: "admin-emails", userIds: named, reason: "the users ADMIN_EMAILS names" };
      }
      return this.#waitForNamedUser();
    }

    const organizations = await this.options.organizations.listProvisioningSummaries();
    if (organizations.length === 0) return waiting("users exist but no organization yet");
    const [only, ...others] = organizations;
    if (!only || others.length > 0) {
      return nobody(`the install has ${organizations.length} organizations, not one`);
    }
    const admin = await this.#oldestActiveAdministrator({ organizationId: only.id });
    if (!admin) return nobody("the only organization has no active administrator");
    return {
      via: "sole-organization-admin",
      userIds: [admin],
      reason: "the oldest active administrator of the only organization",
    };
  }

  /** Waits for a named user; says so once per process, not on every wake. */
  #waitForNamedUser(): PlatformOperatorSeedOutcome {
    const reason = "no user named by ADMIN_EMAILS is verified and active yet";
    if (!this.#namedUserWaitLogged) {
      this.#namedUserWaitLogged = true;
      logger.warn({ reason }, `the platform-operator seed is waiting: ${reason}`);
    }
    return waiting(reason);
  }

  async #anyUserExists(): Promise<boolean> {
    const { emailDomains } = await this.options.users.countUsage();
    return Object.values(emailDomains).some((count) => count > 0);
  }

  /**
   * The active users the list names whose address is verified. Where no email is configured an
   * unverified one counts too: sign-up could never have proved it (ADR-117, revision 2026-09-25).
   */
  async #seedableUsersNamed(adminEmails: readonly string[]): Promise<string[]> {
    const active: UserProfile[] = [];
    for (const email of adminEmails) {
      const user = await this.#namedUser(email);
      if (user && user.deactivatedAt === null) active.push(user);
    }
    const unverifiedCounts =
      active.some((user) => !user.emailVerified) && (await this.options.emailIsUnconfigured());
    const seedable = active.filter((user) => user.emailVerified || unverifiedCounts);
    return [...new Set(seedable.map((user) => user.id))];
  }

  /** An address several case-variant accounts share names nobody: the seed never guesses. */
  async #namedUser(email: string): Promise<UserProfile | null> {
    try {
      return await this.options.users.findByEmail({ email });
    } catch (error) {
      if (!(error instanceof UserEmailAmbiguousError)) throw error;
      logger.warn("ADMIN_EMAILS names an address several accounts share; skipped");
      return null;
    }
  }

  async #oldestActiveAdministrator({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string | undefined> {
    const administrators = await this.options.organizations.findAdministrators({ organizationId });
    const profiles = await Promise.all(
      administrators.map((admin) => this.options.users.findById({ id: admin.userId })),
    );
    return profiles
      .filter((user): user is UserProfile => user !== null && user.deactivatedAt === null)
      .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.id;
  }

  /** Boot's one line while ADMIN_EMAILS is still set: it only ever fed the one-time seed. */
  static bootWarnings({ adminEmails }: { adminEmails: readonly string[] }): string[] {
    if (adminEmails.length === 0) return [];
    return [
      "ADMIN_EMAILS is set but grants nothing: only the one-time platform-operator seed read it. " +
        "Manage operators at /ops/operators, or run the grant-platform-operator task.",
    ];
  }

  async #activeUserOf(email: string): Promise<UserProfile> {
    const user = await this.options.users.findByEmail({ email });
    if (!user) throw new PlatformOperatorUserNotFoundError();
    if (user.deactivatedAt !== null)
      throw new PlatformOperatorUserNotFoundError({ userId: user.id });
    return user;
  }
}

function waiting(reason: string): PlatformOperatorSeedOutcome {
  return { via: "waiting", userIds: [], reason };
}

function nobody(reason: string): PlatformOperatorSeedOutcome {
  logger.warn({ reason }, `no platform operator was seeded; ${RECOVERY_HINT}`);
  return { via: "none", userIds: [], reason };
}

/** Grant and revoke need a real signed-in session: an impersonation never changes who operates. */
function signedInOperator(operator: OpsOperator | null): OpsOperator {
  if (!operator) throw new OpsOperatorSessionRequiredError();
  if (operator.impersonator) throw new OpsImpersonatedOperatorRefusedError();
  return operator;
}

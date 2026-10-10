import { createLogger } from "@langwatch/observability";
import {
  type MigrationCohort,
  type MigrationPassSummary,
  type SystemMigration,
  SystemMigrationRunnerService,
  type SystemMigrationStateRepository,
  groupByTenantSource,
} from "@langwatch/system-migrations";
import { nowInstant } from "@langwatch/time";
import { type TenantMigrationStep, tenantAxisSchema } from "@langwatch/upgrade/step";
import type {
  TenantStepBucket,
  TenantStepSettleService,
  TenantStepSettleState,
} from "@langwatch/upgrade/step/tenant-state";

import type {
  OpsAppDependencies,
  OpsSystemMigrationRunner,
  OrganizationDataplaneResolver,
} from "../../../app/ops.app.ts";
import type { OpsRepositories } from "../../../repositories/ops.repositories.ts";
import { migrationRunsOnThisInstallation } from "../../../rules/ops-system-migration-cohort.rules.ts";
import {
  declarationOf,
  mergeSummaries,
} from "../../../rules/system-migration-pass-summary.rules.ts";
import { RoutingTableOrganizationDataplaneService } from "../../../services/organization-dataplane.service.ts";
import { SystemMigrationPassCohortService } from "./system-migration-pass-cohort.service.ts";
import type { SystemMigrationPassRequestsService } from "./system-migration-pass-requests.service.ts";
import { SystemMigrationsService } from "./system-migrations.service.ts";

const logger = createLogger("langwatch:ops:system-migrations:pass");

/** The ledger, enrollment, membership, tenant walks and lease a pass reads and writes. */
export type SystemMigrationPassRepositories = Pick<
  OpsRepositories,
  | "migrationState"
  | "migrationEnrollments"
  | "migrationMemberships"
  | "migrationLease"
  | "organizationTenants"
  | "projectTenants"
  | "userTenants"
  | "organizationMemberTenants"
>;

type SystemMigrationPassOptions = Readonly<{
  repositories: SystemMigrationPassRepositories;
  /** Cloud pacing is per-organization enrollment; self-hosted admits everyone. */
  isSaaS: () => boolean;
  /** The organization-rooted migrations this installation registered. */
  migrations: () => readonly SystemMigration[];
  tenantAxis?: "organization" | "project";
  /**
   * The USER-rooted migrations this installation registered (ADR-101 §6),
   * driven as a second leg of the same pass over the same lease and state
   * table. Admitted per user through organization membership.
   */
  userMigrations: () => readonly SystemMigration[];
  /**
   * The abandoned-newborn sweep (ADR-116 §3), on the pass's own cadence. A LEG
   * rather than a registered migration, because what it hunts is a claim with
   * no user row behind it - a tenant no source enumerates.
   */
  newbornSweep: () => Promise<unknown>;
  /**
   * Where each organization's data lives. Not a filter - a private data plane
   * never holds an organization back - but a pass that admits one says which
   * instance it landed on. Omitted, every organization reads as shared.
   */
  dataplane?: OrganizationDataplaneResolver;
  /**
   * The tenant steps modules declare with `.withMigrations`, over the framework's one state table
   * (Alex, 2026-10-09, S6-2, S6-3); beside the registered migrations until their owners move.
   */
  declared?: Readonly<{
    steps: () => readonly TenantMigrationStep[];
    state: SystemMigrationStateRepository & TenantStepSettleState;
    /** Level-triggers each driven step's ledger row after the pass (S6-SETTLE). */
    settle: Pick<TenantStepSettleService, "settle">;
  }>;
}>;

/**
 * One migration pass over ops' ledger, enrollment and tenant walks and its lease. Was main's
 * `app-layer/system-migrations/runtime.ts`, minus the migration registry.
 */
export class SystemMigrationPassService {
  static create(options: SystemMigrationPassOptions): SystemMigrationPassService {
    return new SystemMigrationPassService(options);
  }

  readonly #cohorts: SystemMigrationPassCohortService;
  /** Declared tenant steps this process's last pass left pending; each wakes another pass. */
  #pendingDeclaredSteps: readonly string[] = [];

  private constructor(private readonly options: SystemMigrationPassOptions) {
    this.#cohorts = SystemMigrationPassCohortService.create({
      repositories: options.repositories,
      ...(options.dataplane ? { dataplane: options.dataplane } : {}),
    });
  }

  async runPass({ signal }: { signal?: AbortSignal }): Promise<MigrationPassSummary> {
    const isSaaS = this.options.isSaaS();
    const enrollments = this.options.repositories.migrationEnrollments;

    const organization = await this.organizationRunner({ isSaaS, enrollments });
    const userMigrations = this.released({ migrations: this.options.userMigrations(), isSaaS });
    // Both legs' cohorts resolve BEFORE either pass starts, so the two legs
    // read enrollment at the same moment: an operator enrolling mid-pass moves
    // both legs on the next pass, never one leg now and the other later.
    const userCohort =
      userMigrations.length === 0
        ? null
        : await this.#cohorts.user({ isSaaS, enrollments, migrations: userMigrations });

    const summary = await organization.runner.runPass({ signal });

    const merged =
      userCohort === null
        ? summary
        : await this.runUserLeg({
            signal,
            summary,
            cohort: userCohort,
            migrations: userMigrations,
            state: organization.state,
            lease: organization.lease,
          });

    const withDeclared = await this.runDeclaredLeg({ signal, summary: merged, isSaaS });
    await this.sweepAbandonedNewborns();
    return withDeclared;
  }

  /** Declared tenant steps: per axis, one runner per tenant source, on the framework's state. */
  private async runDeclaredLeg({
    signal,
    summary,
    isSaaS,
  }: {
    signal?: AbortSignal;
    summary: MigrationPassSummary;
    isSaaS: boolean;
  }): Promise<MigrationPassSummary> {
    const declared = this.options.declared;
    if (!declared) return summary;
    const { organizationTenants, projectTenants, userTenants, migrationLease } =
      this.options.repositories;
    const sources = {
      organization: organizationTenants,
      project: projectTenants,
      user: userTenants,
    };
    let merged = summary;
    const driven: TenantStepBucket[] = [];
    for (const axis of tenantAxisSchema.options) {
      const steps = declared.steps().filter((step) => step.tenants === axis);
      const migrations = this.released({
        migrations: steps.map((step) => ({ ...step, name: step.id })),
        isSaaS,
      });
      if (migrations.length === 0) continue;
      const cohort = await this.#cohorts.declared({ axis, isSaaS, migrations });
      for (const bucket of groupByTenantSource({ migrations, everyTenant: sources[axis] })) {
        const runner = new SystemMigrationRunnerService({
          now: nowInstant,
          state: declared.state,
          lease: migrationLease,
          tenants: bucket.tenants,
          cohort,
          migrations: bucket.migrations,
        });
        merged = mergeSummaries(merged, await runner.runPass({ signal }));
        driven.push({ ids: bucket.migrations.map((migration) => migration.name), runner });
      }
    }
    this.#pendingDeclaredSteps = await declared.settle.settle({ buckets: driven });
    return merged;
  }

  /**
   * One migration for one organization, now: the operator's targeted run, under the same claim and
   * cohort as a pass. A user-rooted migration drives the organization's members instead, whom the
   * enrollment service has already admitted (main's `runSystemMigrationTargetedPass`).
   */
  async runTargetedPass({
    organizationId,
    migrationName,
    signal,
  }: {
    organizationId: string;
    migrationName: string;
    signal?: AbortSignal;
  }): Promise<MigrationPassSummary> {
    const isSaaS = this.options.isSaaS();
    const { migrationState: state, migrationLease: lease } = this.options.repositories;
    const named = (migration: SystemMigration) => migration.name === migrationName;
    const userMigration = this.released({ migrations: this.options.userMigrations(), isSaaS }).find(
      named,
    );
    if (userMigration) {
      return new SystemMigrationRunnerService({
        now: nowInstant,
        state,
        lease,
        tenants: this.options.repositories.organizationMemberTenants.membersOf({ organizationId }),
        cohort: () => true,
        migrations: [userMigration],
      }).runPass({ signal });
    }

    const migrations = this.released({ migrations: this.options.migrations(), isSaaS }).filter(
      named,
    );
    return new SystemMigrationRunnerService({
      now: nowInstant,
      state,
      lease,
      tenants: {
        findTenantIdsAfter: async ({ cursor }) => (cursor === null ? [organizationId] : []),
      },
      cohort: await this.#cohorts.organization({
        isSaaS,
        enrollments: this.options.repositories.migrationEnrollments,
        migrations,
      }),
      migrations,
    }).runPass({ signal });
  }

  /**
   * Whether a pass on this installation could still move or discover a tenant, asked only about the
   * migrations it runs: a held or parked tenant, or an automatic migration no tenant has met yet (a
   * new registration, a fresh install). A latched fleet pays one indexed read per migration.
   */
  async hasTenantAwaitingRedrive(): Promise<boolean> {
    const isSaaS = this.options.isSaaS();
    const registered = [
      ...this.released({ migrations: this.options.migrations(), isSaaS }),
      ...this.released({ migrations: this.options.userMigrations(), isSaaS }),
    ];
    const state = this.options.repositories.migrationState;
    const migrationNames = registered.map((migration) => migration.name);
    if (await state.hasTenantAwaitingRedrive({ migrationNames })) return true;
    for (const migration of registered) {
      if (!admitsUnenrolled({ isSaaS, migration })) continue;
      if (await state.hasFinalizedTenant({ migrationName: migration.name })) continue;
      const pinned = await state.findRecordsByStatus({
        migrationName: migration.name,
        statuses: ["rolled_back"],
        limit: 1,
      });
      if (pinned.length === 0) return true;
    }
    return this.hasDeclaredStepAwaitingPass({ isSaaS });
  }

  /** The same question of the declared tenant steps, over the framework's own state table. */
  private async hasDeclaredStepAwaitingPass({ isSaaS }: { isSaaS: boolean }): Promise<boolean> {
    const declared = this.options.declared;
    if (!declared) return false;
    if (this.#pendingDeclaredSteps.length > 0) return true;
    const steps = this.released({
      migrations: declared.steps().map((step) => ({ ...step, name: step.id })),
      isSaaS,
    });
    for (const step of steps) {
      if (await declared.state.hasUnsettledTenant({ migrationName: step.name })) return true;
      if (!admitsUnenrolled({ isSaaS, migration: step })) continue;
      // ponytail: a step whose every tenant was rolled back reads as unmet and is passed each wake.
      if (!(await declared.state.hasFinalizedTenant({ migrationName: step.name }))) return true;
    }
    return false;
  }

  /**
   * The USER-rooted leg, one runner per tenant source. A migration that
   * declares its own candidates keeps them; a bucket driven over every user
   * is cut to the users with work left for exactly that bucket's migrations.
   */
  private async runUserLeg({
    signal,
    summary,
    cohort,
    migrations,
    state,
    lease,
  }: {
    signal?: AbortSignal;
    summary: MigrationPassSummary;
    cohort: MigrationCohort;
    migrations: readonly SystemMigration[];
    state: SystemMigrationPassRepositories["migrationState"];
    lease: SystemMigrationPassRepositories["migrationLease"];
  }): Promise<MigrationPassSummary> {
    const everyUser = this.options.repositories.userTenants;
    let merged = summary;
    // Narrowed AFTER grouping, never before: buckets are formed by comparing
    // sources by identity, so a fresh narrowed object per migration would
    // split one bucket into several.
    for (const bucket of groupByTenantSource({ migrations, everyTenant: everyUser })) {
      const tenants =
        bucket.tenants === everyUser
          ? everyUser.pendingFor({
              migrationNames: bucket.migrations.map((migration) => migration.name),
            })
          : bucket.tenants;
      merged = mergeSummaries(
        merged,
        await new SystemMigrationRunnerService({
          now: nowInstant,
          state,
          lease,
          tenants,
          cohort,
          migrations: bucket.migrations,
        }).runPass({ signal }),
      );
    }

    return merged;
  }

  private async organizationRunner({
    isSaaS,
    enrollments = this.options.repositories.migrationEnrollments,
  }: {
    isSaaS: boolean;
    enrollments?: SystemMigrationPassRepositories["migrationEnrollments"];
  }) {
    const { migrationState: state, migrationLease: lease } = this.options.repositories;
    const migrations = this.released({ migrations: this.options.migrations(), isSaaS });
    const organizationCohort = await this.#cohorts.organization({
      isSaaS,
      enrollments,
      migrations,
    });
    const projectTenants =
      this.options.tenantAxis === "project" ? this.options.repositories.projectTenants : null;
    const cohort: MigrationCohort =
      projectTenants && isSaaS
        ? async ({ tenantId, migrationName }) =>
            organizationCohort({
              tenantId: await projectTenants.getOrganizationId(tenantId),
              migrationName,
            })
        : organizationCohort;
    // Only the organizations with something left to do: one that has latched
    // every migration in this list will never move again, and enumerating it
    // costs a claim, a state read per migration and a release — per pass, per
    // replica, forever. A project-axis source declares its own tenants and is
    // left exactly as it is.
    const tenants =
      projectTenants ??
      this.options.repositories.organizationTenants.pendingFor({
        migrationNames: migrations.map((migration) => migration.name),
      });
    return {
      state,
      lease,
      tenants,
      migrations,
      cohort,
      runner: new SystemMigrationRunnerService({
        state,
        lease,
        tenants,
        cohort,
        migrations,
        now: nowInstant,
      }),
    };
  }

  /**
   * Never terminal: the sweep removes rows the pass did not write, so a pass
   * that reported nothing because a sweep threw would hide the migration
   * outcome an operator asked for.
   */
  private async sweepAbandonedNewborns(): Promise<void> {
    try {
      await this.options.newbornSweep();
    } catch (error) {
      logger.warn(
        { error },
        "the abandoned-newborn sweep failed; the claims stay and the next pass retries",
      );
    }
  }

  /** Self-hosted drives only the migrations already released for it. */
  private released({
    migrations,
    isSaaS,
  }: {
    migrations: readonly SystemMigration[];
    isSaaS: boolean;
  }): readonly SystemMigration[] {
    return migrations.filter((migration) =>
      migrationRunsOnThisInstallation({
        isSaaS,
        runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
      }),
    );
  }

  /**
   * The migrations page and the worker's pass over ops' ledger, enrolment and lease, each peer
   * answering its own registry (main's `system-migrations/runtime.ts`). A process whose peers
   * register nothing lists nothing rather than refusing.
   */
  static runner({
    repositories,
    isSaaS,
    routes,
    dependencies,
    passRequests,
    declared,
  }: Pick<SystemMigrationPassOptions, "repositories" | "isSaaS" | "declared"> & {
    /** The clickhouse store's private routes (§7), read when a cohort or pass asks, not at boot. */
    routes: () => ReadonlyMap<string, string>;
    dependencies: Pick<OpsAppDependencies, "identity" | "authz" | "automations" | "auditLog">;
    passRequests: Pick<SystemMigrationPassRequestsService, "request">;
  }): OpsSystemMigrationRunner {
    const { identity, authz, auditLog } = dependencies;
    // Main's registry order: authorization's import, then identity's D04.
    const organizationMigrations = () => [
      ...authz.registeredMigrations(),
      ...identity.registeredMigrations(),
    ];
    const passes = SystemMigrationPassService.create({
      repositories,
      isSaaS,
      ...(declared ? { declared } : {}),
      migrations: organizationMigrations,
      userMigrations: () => identity.userMigrations(),
      newbornSweep: () => identity.newbornSweep().runPass(),
      dataplane: {
        dataplaneFor: (organizationId) =>
          RoutingTableOrganizationDataplaneService.create({ routes: routes() }).dataplaneFor(
            organizationId,
          ),
      },
    });
    return SystemMigrationsService.create({
      state: repositories.migrationState,
      migrations: () => [
        ...organizationMigrations().map((migration) =>
          declarationOf({ migration, tenant: "organization" }),
        ),
        ...identity
          .userMigrations()
          .map((migration) => declarationOf({ migration, tenant: "user" })),
      ],
      isSaaS,
      enrollments: repositories.migrationEnrollments,
      privateDataplaneOrganizationIds: () => [...routes().keys()],
      audit: async ({ userId, organizationId, action, args }) => {
        await auditLog.record({
          userId,
          action,
          ...(organizationId === undefined ? {} : { organizationId }),
          ...(args === undefined ? {} : { args }),
        });
      },
      runPass: (input) => passes.runPass(input),
      runTargetedPass: (target) => passes.runTargetedPass(target),
      requestPass: (request) => passRequests.request(request),
      hasTenantAwaitingRedrive: () => passes.hasTenantAwaitingRedrive(),
    });
  }
}

/** Admitted without operator enrollment: every self-hosted release, cloud once it has soaked. */
function admitsUnenrolled({
  isSaaS,
  migration,
}: {
  isSaaS: boolean;
  migration: SystemMigration;
}): boolean {
  return !isSaaS || migration.enrolledAutomatically;
}

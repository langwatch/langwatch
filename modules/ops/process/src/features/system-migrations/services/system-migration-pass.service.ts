import { createLogger } from "@langwatch/observability";
import {
  type MigrationPassSummary,
  type SystemMigration,
  type SystemMigrationRunnerDeps,
  SystemMigrationRunnerService,
  type SystemMigrationStateRepository,
  type TenantSource,
  groupByTenantSource,
} from "@langwatch/system-migrations";
import { nowInstant } from "@langwatch/time";
import {
  type TenantAxis,
  type TenantMigrationStep,
  tenantAxisSchema,
} from "@langwatch/upgrade/step";
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
  NO_PASS_SUMMARY,
  declarationsOf,
  mergeSummaries,
} from "../../../rules/system-migration-pass-summary.rules.ts";
import type { SystemMigrationStateReader } from "../../../rules/system-migration-support.rules.ts";
import { RoutingTableOrganizationDataplaneService } from "../../../services/organization-dataplane.service.ts";
import type { SystemMigrationLegacyMirrorService } from "./system-migration-legacy-mirror.service.ts";
import { SystemMigrationPassCohortService } from "./system-migration-pass-cohort.service.ts";
import type { SystemMigrationPassRequestsService } from "./system-migration-pass-requests.service.ts";
import type { SystemMigrationRollbackFactsService } from "./system-migration-rollback-facts.service.ts";
import { SystemMigrationsService } from "./system-migrations.service.ts";

const logger = createLogger("langwatch:ops:system-migrations:pass");

/** The enrollment, membership, tenant walks, lease and queue a pass reads and writes. */
export type SystemMigrationPassRepositories = Pick<
  OpsRepositories,
  | "migrationEnrollments"
  | "migrationMemberships"
  | "migrationLease"
  | "organizationTenants"
  | "projectTenants"
  | "userTenants"
  | "organizationMemberTenants"
  | "queues"
>;

/**
 * The tenant steps modules declare with `.withMigrations`, over the framework's one state table
 * (Alex, 2026-10-09, S6-2, S6-3); since the identity and authz migrations moved, the only ones.
 */
type DeclaredTenantSteps = Readonly<{
  steps: () => readonly TenantMigrationStep[];
  state: SystemMigrationStateRepository & TenantStepSettleState & SystemMigrationStateReader;
  /** Level-triggers each driven step's ledger row after the pass (S6-SETTLE). */
  settle: Pick<TenantStepSettleService, "settle">;
  /** Whether every live process ships the step; a step needing old writers gone waits. */
  oldWritersGoneFor?: (input: { stepId: string }) => Promise<boolean>;
}>;

type SystemMigrationPassOptions = Readonly<{
  repositories: SystemMigrationPassRepositories;
  /** Cloud pacing is per-organization enrollment; self-hosted admits everyone. */
  isSaaS: () => boolean;
  /**
   * The abandoned-newborn sweep (ADR-116 §3), on the pass's own cadence. A LEG
   * rather than a declared step, because what it hunts is a claim with
   * no user row behind it - a tenant no source enumerates.
   */
  newbornSweep: () => Promise<unknown>;
  /**
   * Where each organization's data lives. Not a filter - a private data plane
   * never holds an organization back - but a pass that admits one says which
   * instance it landed on. Omitted, every organization reads as shared.
   */
  dataplane?: OrganizationDataplaneResolver;
  /** The worker's listed queue runs, which pace a paced pass by its own jobs (Alex, 2026-10-12). */
  runListedWork?: SystemMigrationRunnerDeps["runListedWork"];
  declared: DeclaredTenantSteps;
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
  /** The waiting-job count a paced migration holds its next page behind (Alex, 2026-10-12). */
  readonly #queuedJobs = (): Promise<number> => this.options.repositories.queues.countWaitingJobs();
  /** A paced pass counts its own jobs where the worker runs listed work, else the whole queue's. */
  get #pacing(): Pick<SystemMigrationRunnerDeps, "queuedJobs" | "runListedWork"> {
    const { runListedWork } = this.options;
    return { queuedJobs: this.#queuedJobs, ...(runListedWork ? { runListedWork } : {}) };
  }

  private constructor(private readonly options: SystemMigrationPassOptions) {
    this.#cohorts = SystemMigrationPassCohortService.create({
      repositories: options.repositories,
      ...(options.dataplane ? { dataplane: options.dataplane } : {}),
    });
  }

  async runPass({ signal }: { signal?: AbortSignal }): Promise<MigrationPassSummary> {
    const summary = await this.runDeclaredLeg({ signal, isSaaS: this.options.isSaaS() });
    await this.sweepAbandonedNewborns();
    return summary;
  }

  /** Declared tenant steps: per axis, one runner per tenant source, on the framework's state. */
  private async runDeclaredLeg({
    signal,
    isSaaS,
  }: {
    signal?: AbortSignal;
    isSaaS: boolean;
  }): Promise<MigrationPassSummary> {
    const { declared } = this.options;
    const { migrationLease } = this.options.repositories;
    let merged = NO_PASS_SUMMARY;
    const driven: TenantStepBucket[] = [];
    const runnable = await this.runnableDeclaredSteps();
    for (const axis of tenantAxisSchema.options) {
      const steps = runnable.filter((step) => step.tenants === axis);
      const migrations = this.released({ migrations: steps.map(migrationOf), isSaaS });
      if (migrations.length === 0) continue;
      const cohort = await this.#cohorts.declared({ axis, isSaaS, migrations });
      const everyTenant = this.everyTenant({ axis });
      // Narrowed AFTER grouping, never before: buckets are formed by comparing sources by
      // identity, so a fresh narrowed source per step would split one bucket into several.
      for (const bucket of groupByTenantSource({ migrations, everyTenant })) {
        const runner = new SystemMigrationRunnerService({
          now: nowInstant,
          ...this.#pacing,
          state: declared.state,
          lease: migrationLease,
          tenants:
            bucket.tenants === everyTenant
              ? this.pendingTenants({ axis, migrations: bucket.migrations })
              : bucket.tenants,
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

  /** Every tenant of one axis, the source a step declaring no candidates is grouped under. */
  private everyTenant({ axis }: { axis: TenantAxis }): TenantSource {
    const { organizationTenants, projectTenants, userTenants } = this.options.repositories;
    return { organization: organizationTenants, project: projectTenants, user: userTenants }[axis];
  }

  /**
   * Only the organizations or users with work left in these steps: one that finished them all
   * would cost a claim, a state read per step and a release, per pass, per replica, forever. A
   * project walk is left as it is.
   */
  private pendingTenants({
    axis,
    migrations,
  }: {
    axis: TenantAxis;
    migrations: readonly SystemMigration[];
  }): TenantSource {
    const { organizationTenants, projectTenants, userTenants } = this.options.repositories;
    const migrationNames = migrations.map((migration) => migration.name);
    if (axis === "organization") return organizationTenants.pendingFor({ migrationNames });
    if (axis === "user") return userTenants.pendingFor({ migrationNames });
    return projectTenants;
  }

  /** A step declaring `needsOldWritersGone` is passed only once no older image is live (§7). */
  private async runnableDeclaredSteps(): Promise<TenantMigrationStep[]> {
    const { declared } = this.options;
    const runnable: TenantMigrationStep[] = [];
    for (const step of declared.steps()) {
      if (step.needsOldWritersGone && declared.oldWritersGoneFor) {
        if (!(await declared.oldWritersGoneFor({ stepId: step.id }))) continue;
      }
      runnable.push(step);
    }
    return runnable;
  }

  /**
   * One step for one organization, now, under the same claim and cohort as a pass; a user step
   * drives its members, whom enrollment already admitted (main's `runSystemMigrationTargetedPass`).
   * A step still waiting for older images, or on the project axis, drives nobody.
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
    const { declared } = this.options;
    const { migrationLease: lease, organizationMemberTenants } = this.options.repositories;
    const step = (await this.runnableDeclaredSteps()).find(({ id }) => id === migrationName);
    const migrations = step ? this.released({ migrations: [migrationOf(step)], isSaaS }) : [];
    if (!step || migrations.length === 0 || step.tenants === "project") return NO_PASS_SUMMARY;
    const run = { now: nowInstant, ...this.#pacing, state: declared.state, lease, migrations };
    if (step.tenants === "user") {
      return new SystemMigrationRunnerService({
        ...run,
        tenants: organizationMemberTenants.membersOf({ organizationId }),
        cohort: () => true,
      }).runPass({ signal });
    }
    return new SystemMigrationRunnerService({
      ...run,
      tenants: {
        findTenantIdsAfter: async ({ cursor }) => (cursor === null ? [organizationId] : []),
      },
      cohort: await this.#cohorts.declared({ axis: "organization", isSaaS, migrations }),
    }).runPass({ signal });
  }

  /**
   * Whether a pass on this installation could still move or discover a tenant, asked only about
   * the steps it runs: a held or parked tenant, a step this process's last pass left pending, or
   * an automatic step no tenant has finished yet (a new declaration, a fresh install).
   */
  async hasTenantAwaitingRedrive(): Promise<boolean> {
    const isSaaS = this.options.isSaaS();
    const { declared } = this.options;
    if (this.#pendingDeclaredSteps.length > 0) return true;
    const steps = this.released({ migrations: declared.steps().map(migrationOf), isSaaS });
    for (const step of steps) {
      if (await declared.state.hasUnsettledTenant({ migrationName: step.name })) return true;
      if (!admitsUnenrolled({ isSaaS, migration: step })) continue;
      if (await declared.state.hasFinalizedTenant({ migrationName: step.name })) continue;
      // A step whose every touched tenant an operator rolled back has met them all.
      const pinned = await declared.state.findRecordsByStatus({
        migrationName: step.name,
        statuses: ["rolled_back"],
        limit: 1,
      });
      if (pinned.length === 0) return true;
    }
    return false;
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
   * The migrations page and the worker's pass over the declared tenant steps, ops' enrolment and
   * lease (main's `system-migrations/runtime.ts`). A process that declares none lists nothing.
   */
  static runner({
    repositories,
    isSaaS,
    routes,
    dependencies,
    passRequests,
    rollbackFacts,
    declared,
    runListedWork,
    legacyMirror,
  }: Pick<SystemMigrationPassOptions, "repositories" | "isSaaS" | "declared" | "runListedWork"> & {
    /** Writes the moved steps' state and enrolments to ops' older tables too (Alex, 2026-10-12). */
    legacyMirror?: SystemMigrationLegacyMirrorService;
    /** Tells a step's owner its tenant was rolled back (Alex, 2026-10-12). */
    rollbackFacts?: Pick<SystemMigrationRollbackFactsService, "record">;
    /** The clickhouse store's private routes (§7), read when a cohort or pass asks, not at boot. */
    routes: () => ReadonlyMap<string, string>;
    dependencies: Pick<OpsAppDependencies, "identity" | "auditLog">;
    passRequests: Pick<SystemMigrationPassRequestsService, "request">;
  }): OpsSystemMigrationRunner {
    const { identity, auditLog } = dependencies;
    const state = legacyMirror ? legacyMirror.state(declared.state) : declared.state;
    const enrollments = legacyMirror
      ? legacyMirror.enrollments(repositories.migrationEnrollments)
      : repositories.migrationEnrollments;
    const passes = SystemMigrationPassService.create({
      repositories,
      isSaaS,
      declared: { ...declared, state },
      ...(runListedWork ? { runListedWork } : {}),
      newbornSweep: () => identity.newbornSweep().runPass(),
      dataplane: {
        dataplaneFor: (organizationId) =>
          RoutingTableOrganizationDataplaneService.create({ routes: routes() }).dataplaneFor(
            organizationId,
          ),
      },
    });
    return SystemMigrationsService.create({
      state,
      migrations: () => declarationsOf({ steps: declared.steps() }),
      isSaaS,
      enrollments,
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
      ...(rollbackFacts ? { recordRolledBack: (fact) => rollbackFacts.record(fact) } : {}),
      hasTenantAwaitingRedrive: () => passes.hasTenantAwaitingRedrive(),
    });
  }
}

/** A declared step as the runner keys it: its id is the state table's migration name. */
function migrationOf(step: TenantMigrationStep): SystemMigration {
  return { ...step, name: step.id };
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

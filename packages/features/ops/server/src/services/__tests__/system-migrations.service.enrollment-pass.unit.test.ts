/**
 * Pass-level proof of the pacing rules, composed the way
 * `runSystemMigrationPass` composes them: the real runner from
 * @langwatch/system-migrations, the real cohort helpers from ../cohort, and
 * the migration list filtered by each migration's own
 * `runsAutomaticallyOnSelfHosted` declaration. What is faked is storage -
 * this is about who gets processed, not how state is stored.
 */
import {
  type SystemMigration,
  SystemMigrationRunnerService,
  type SystemMigrationStateRepository,
  type TenantMigrationRecord,
} from "@langwatch/system-migrations";
import { describe, expect, it, vi } from "vitest";
import {
  migrationRunsOnThisInstallation,
  organizationMigrates,
} from "../../ops.system-migration-cohort";

class InMemoryStateRepository implements SystemMigrationStateRepository {
  private readonly rows = new Map<string, TenantMigrationRecord>();

  async findRecord({
    migrationName,
    tenantId,
  }: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord | null> {
    return this.rows.get(`${migrationName}:${tenantId}`) ?? null;
  }

  async upsertRecord(record: TenantMigrationRecord): Promise<void> {
    this.rows.set(`${record.migrationName}:${record.tenantId}`, record);
  }

  async upsertRecordUnlessRolledBack(record: TenantMigrationRecord): Promise<boolean> {
    // The production contract: an operator's `rolled_back` pin refuses the
    // write. The fake honors it so a pass that WOULD overwrite a pin fails
    // here instead of passing against a stub looser than the real store.
    const existing = await this.findRecord({
      migrationName: record.migrationName,
      tenantId: record.tenantId,
    });
    if (existing?.status === "rolled_back") return false;
    await this.upsertRecord(record);
    return true;
  }

  /**
   * The per-tenant gate's global short-circuit. Answered from the same rows
   * the pass writes, so a suite about who gets processed never has to keep a
   * second source of truth in agreement with the first.
   */
  async hasFinalizedTenant({ migrationName }: { migrationName: string }): Promise<boolean> {
    return [...this.rows.values()].some(
      (row) => row.migrationName === migrationName && row.status === "finalized",
    );
  }

  tenantIdsWithRecords(): string[] {
    return [...new Set([...this.rows.values()].map((row) => row.tenantId))];
  }
}

const grantedLease = {
  acquire: async () => true,
  renew: async () => true,
  release: async () => undefined,
};

function tenantSourceOf(ids: string[]) {
  return {
    async findTenantIdsAfter({ cursor, limit }: { cursor: string | null; limit: number }) {
      const start = cursor === null ? 0 : ids.indexOf(cursor) + 1;
      return ids.slice(start, start + limit);
    },
  };
}

function migrationOf({
  name,
  runsAutomaticallyOnSelfHosted,
  enrolledAutomatically = false,
}: {
  name: string;
  runsAutomaticallyOnSelfHosted: boolean;
  enrolledAutomatically?: boolean;
}): SystemMigration & { migrateTenant: ReturnType<typeof vi.fn> } {
  return {
    name,
    title: name,
    description: name,
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted,
    enrolledAutomatically,
    migrateTenant: vi.fn(async () => ({ status: "finalized" as const })),
  };
}

/**
 * The pass, composed exactly as runtime.ts composes it: enrollment is per
 * (organization, migration), read into a map the cohort probes, and a
 * migration's own `enrolledAutomatically` declaration is what lets it skip
 * that map entirely.
 */
function passOn({
  isSaaS,
  tenants,
  enrolled,
  migrations,
  state,
}: {
  isSaaS: boolean;
  tenants: string[];
  enrolled: Map<string, Set<string>>;
  migrations: SystemMigration[];
  state: SystemMigrationStateRepository;
}) {
  const automatic = new Set(
    migrations
      .filter((migration) => migration.enrolledAutomatically)
      .map((migration) => migration.name),
  );
  return new SystemMigrationRunnerService({
    state,
    lease: grantedLease,
    tenants: tenantSourceOf(tenants),
    cohort: ({ tenantId, migrationName }) =>
      organizationMigrates({
        isSaaS,
        enrolledAutomatically: automatic.has(migrationName),
        enrolled: enrolled.get(migrationName)?.has(tenantId) ?? false,
      }),
    migrations: migrations.filter((migration) =>
      migrationRunsOnThisInstallation({
        isSaaS,
        runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
      }),
    ),
  }).runPass();
}

describe("the migration pass under its cohort rules", () => {
  describe("given a self-hosted installation with a migration not yet released for it", () => {
    /** @scenario "A migration not yet released for self-hosting never runs there" */
    it("drives the released migrations for every organization and never attempts the unreleased one", async () => {
      const released = migrationOf({
        name: "released",
        runsAutomaticallyOnSelfHosted: true,
      });
      const unreleased = migrationOf({
        name: "unreleased",
        runsAutomaticallyOnSelfHosted: false,
      });
      const state = new InMemoryStateRepository();

      const summary = await passOn({
        isSaaS: false,
        tenants: ["acme", "globex"],
        enrolled: new Map(),
        migrations: [released, unreleased],
        state,
      });

      expect(released.migrateTenant).toHaveBeenCalledTimes(2);
      expect(unreleased.migrateTenant).not.toHaveBeenCalled();
      // Never attempted means never reported either: no state row exists for
      // the unreleased migration, so nothing reads as parked or held.
      expect(
        await state.findRecord({
          migrationName: "unreleased",
          tenantId: "acme",
        }),
      ).toBeNull();
      expect(summary?.finalized).toBe(2);
    });
  });

  describe("given a release that declares the migration ready for self-hosting", () => {
    /** @scenario "A release that turns a migration on for self-hosting makes it run on the next pass" */
    it("drives it for every organization on the next pass", async () => {
      const nowReleased = migrationOf({
        name: "cutover-like",
        runsAutomaticallyOnSelfHosted: true,
      });

      await passOn({
        isSaaS: false,
        tenants: ["acme", "globex"],
        enrolled: new Map(),
        migrations: [nowReleased],
        state: new InMemoryStateRepository(),
      });

      expect(nowReleased.migrateTenant).toHaveBeenCalledTimes(2);
      expect(nowReleased.migrateTenant).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "acme" }),
      );
      expect(nowReleased.migrateTenant).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "globex" }),
      );
    });
  });

  describe("given a cloud installation", () => {
    /** @scenario "Cloud rollout is unaffected by the self-hosted release declaration" */
    it("drives every registered migration for an enrolled organization, whatever it declares", async () => {
      const releasedForSelfHosting = migrationOf({
        name: "released",
        runsAutomaticallyOnSelfHosted: true,
      });
      const notReleasedForSelfHosting = migrationOf({
        name: "unreleased",
        runsAutomaticallyOnSelfHosted: false,
      });
      const state = new InMemoryStateRepository();

      await passOn({
        isSaaS: true,
        tenants: ["acme", "globex"],
        enrolled: new Map([
          ["released", new Set(["acme"])],
          ["unreleased", new Set(["acme"])],
        ]),
        migrations: [releasedForSelfHosting, notReleasedForSelfHosting],
        state,
      });

      for (const migration of [releasedForSelfHosting, notReleasedForSelfHosting]) {
        expect(migration.migrateTenant).toHaveBeenCalledTimes(1);
        expect(migration.migrateTenant).toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: "acme" }),
        );
      }
      // The un-enrolled organization was left untouched with no state: only
      // the enrolled organization holds records. A bare count of 2 could
      // also be one record per organization, which would mean globex ran.
      expect(state.tenantIdsWithRecords()).toEqual(["acme"]);
    });

    /** @scenario "Each migration is enrolled separately and paces independently" */
    it("drives only the migrations an organization is enrolled for, recording nothing for the others", async () => {
      const backfillLike = migrationOf({
        name: "backfill-like",
        runsAutomaticallyOnSelfHosted: true,
      });
      const cutoverLike = migrationOf({
        name: "cutover-like",
        runsAutomaticallyOnSelfHosted: false,
      });
      const state = new InMemoryStateRepository();

      await passOn({
        isSaaS: true,
        tenants: ["acme"],
        enrolled: new Map([["backfill-like", new Set(["acme"])]]),
        migrations: [backfillLike, cutoverLike],
        state,
      });

      expect(backfillLike.migrateTenant).toHaveBeenCalledTimes(1);
      expect(cutoverLike.migrateTenant).not.toHaveBeenCalled();
      // Untouched means no state either: "not enrolled yet" and "not
      // started" stay the same pending state for the unenrolled migration.
      expect(
        await state.findRecord({
          migrationName: "cutover-like",
          tenantId: "acme",
        }),
      ).toBeNull();
    });
  });

  describe("given a cloud installation and a migration enrolled automatically", () => {
    /** @scenario "An organization nobody enrolled migrates for an automatically enrolled migration" */
    it("drives it for every organization, including one created after the rollout finished", async () => {
      const automatic = migrationOf({
        name: "authz-engine-like",
        runsAutomaticallyOnSelfHosted: true,
        enrolledAutomatically: true,
      });
      const state = new InMemoryStateRepository();

      // "acme" is the organization an operator enrolled while the rollout was
      // running; "born_later" is the one created since, which nothing enrolled
      // and which used to sit on the legacy path indefinitely.
      await passOn({
        isSaaS: true,
        tenants: ["acme", "born_later"],
        enrolled: new Map([["authz-engine-like", new Set(["acme"])]]),
        migrations: [automatic],
        state,
      });

      expect(automatic.migrateTenant).toHaveBeenCalledTimes(2);
      expect(state.tenantIdsWithRecords().sort()).toEqual(["acme", "born_later"]);
    });
  });
});

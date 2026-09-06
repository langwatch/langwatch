/**
 * The one place that looks up a migration by name and refuses on behalf of
 * every migration-scoped operator action. Kept beside the services (not
 * `rules/`) because it throws a domain error, which a rules module may not
 * construct.
 */
import { MigrationUnknownError } from "@langwatch/ops-contract";
import type { SystemMigrationsServiceDependencies } from "../rules/system-migration-support.rules";

export class SystemMigrationLookupService {
  static create(): SystemMigrationLookupService {
    return new SystemMigrationLookupService();
  }

  private constructor() {}

  /** The migration a name refers to, or the refusal the operator can act on. */
  registeredMigration(
    deps: SystemMigrationsServiceDependencies,
    migrationName: string,
  ): ReturnType<SystemMigrationsServiceDependencies["migrations"]>[number] {
    const migration = deps.migrations().find((candidate) => candidate.name === migrationName);
    if (!migration) {
      throw new MigrationUnknownError();
    }

    return migration;
  }
}

/** Stateless, so one instance serves every caller. */
export const systemMigrationLookup = SystemMigrationLookupService.create();

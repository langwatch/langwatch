import { createLogger } from "@langwatch/observability";
import {
  driveSystemMigrationsToConvergence,
  type SystemMigrationPass,
} from "@langwatch/system-migrations";
import { Task } from "@langwatch/task";

const logger = createLogger("langwatch:task:system-migrations-pass");

/**
 * Bounded passes of the in-place system migrations, until nothing moves or the
 * cap. Never a gate: held and parked tenants are reported, not waited on (plan
 * §6.8, Alex Q7); specs/migration/system-migrations-runner.feature.
 */
export class SystemMigrationsPassTask extends Task {
  readonly name = "system-migrations-pass";
  readonly description =
    "Runs every registered in-place migration over every tenant in its cohort until nothing advances.";

  private constructor(private readonly pass: () => SystemMigrationPass) {
    super();
  }

  static create({ pass }: { pass: () => SystemMigrationPass }): SystemMigrationsPassTask {
    return new SystemMigrationsPassTask(pass);
  }

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    logger.info("driving system migrations to convergence");
    await driveSystemMigrationsToConvergence({ runPass: this.pass(), signal });
  }
}

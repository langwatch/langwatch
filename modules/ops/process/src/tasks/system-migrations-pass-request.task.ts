import { Task } from "@langwatch/task";

/**
 * Asks a worker for one system-migrations pass now, so tenant steps settle minutes after an
 * upgrade rather than at the hourly re-drive. A request that cannot be sent is logged, never
 * thrown: the re-drive still reaches it. Spec: modules/ops/specs/ops-system-migrations.feature.
 */
export class SystemMigrationsPassRequestTask extends Task {
  readonly name = "request-system-migrations-pass";
  readonly description =
    "Asks a worker for one pass of the in-place migrations now, as a finished upgrade does.";

  private constructor(private readonly request: () => Promise<void>) {
    super();
  }

  static create({ request }: { request: () => Promise<void> }): SystemMigrationsPassRequestTask {
    return new SystemMigrationsPassRequestTask(request);
  }

  async run(): Promise<void> {
    await this.request();
  }
}

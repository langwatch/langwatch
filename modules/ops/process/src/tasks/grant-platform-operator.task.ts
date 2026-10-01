import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import type { OpsModule } from "../app/ops.app.ts";

const logger = createLogger("langwatch:task:grant-platform-operator");

/**
 * The way back in: grants the platform-operator role as the system to the account an address
 * belongs to. Self-hosted lockout recovery and the cloud cutover's staff seed
 * (ARCHITECTURE.md, "Operator bootstrap"). Shell access already implies full control.
 */
export class GrantPlatformOperatorTask extends Task {
  readonly name = "grant-platform-operator";
  readonly description =
    "Grants the platform-operator role to the existing, active account an email address belongs to.";

  private constructor(private readonly operators: Pick<OpsModule, "grantPlatformOperatorAsSystem">) {
    super();
  }

  static create({
    operators,
  }: {
    operators: Pick<OpsModule, "grantPlatformOperatorAsSystem">;
  }): GrantPlatformOperatorTask {
    return new GrantPlatformOperatorTask(operators);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const email = args.find((arg) => !arg.startsWith("--"))?.trim();
    if (!email) throw new Error("grant-platform-operator requires an email address");

    const granted = await this.operators.grantPlatformOperatorAsSystem({ email });
    logger.info(
      { userId: granted.userId, grantId: granted.grantId },
      "granted the platform-operator role",
    );
  }
}

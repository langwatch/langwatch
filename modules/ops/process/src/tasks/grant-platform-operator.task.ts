import { AuthzGrantNotConfirmedError } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import { nowInstant } from "@langwatch/time";

import type { OpsModule } from "../app/ops.app.ts";

const logger = createLogger("langwatch:task:grant-platform-operator");

type Operators = Pick<OpsModule, "grantPlatformOperatorAsSystem" | "listPlatformOperators">;

/** How long the task waits for an accepted grant to become readable, backing off between reads. */
export type GrantConfirmationWait = Readonly<{
  timeoutMs: number;
  initialDelayMs: number;
  maxDelayMs: number;
}>;

const DEFAULT_WAIT: GrantConfirmationWait = {
  timeoutMs: 120_000,
  initialDelayMs: 1_000,
  maxDelayMs: 15_000,
};

/**
 * The way back in: grants the platform-operator role as the system to the account an address
 * belongs to. Self-hosted lockout recovery and the cloud cutover's staff seed
 * (ARCHITECTURE.md, "Operator bootstrap"). Shell access already implies full control.
 */
export class GrantPlatformOperatorTask extends Task {
  readonly name = "grant-platform-operator";
  readonly description =
    "Grants the platform-operator role to the existing, active, verified account an email address belongs to.";

  private constructor(
    private readonly operators: Operators,
    private readonly wait: GrantConfirmationWait,
  ) {
    super();
  }

  static create({
    operators,
    wait = DEFAULT_WAIT,
  }: {
    operators: Operators;
    wait?: GrantConfirmationWait;
  }): GrantPlatformOperatorTask {
    return new GrantPlatformOperatorTask(operators, wait);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const email = args.find((arg) => !arg.startsWith("--"))?.trim();
    if (!email) throw new Error("grant-platform-operator requires an email address");

    try {
      const granted = await this.operators.grantPlatformOperatorAsSystem({ email });
      logger.info(
        { userId: granted.userId, grantId: granted.grantId },
        "granted the platform-operator role",
      );
    } catch (error) {
      // The grant event is durable; only its projection lags (eventual consistency, not failure).
      if (!(error instanceof AuthzGrantNotConfirmedError)) throw error;
      await this.#awaitApplied({ email, signal });
    }
  }

  async #awaitApplied({ email, signal }: { email: string; signal: AbortSignal }): Promise<void> {
    const deadline = nowInstant().epochMilliseconds + this.wait.timeoutMs;
    let delayMs = this.wait.initialDelayMs;
    while (!signal.aborted && nowInstant().epochMilliseconds < deadline) {
      logger.info({ email, nextCheckMs: delayMs }, "grant recorded; waiting for it to be applied");
      await sleep({ ms: Math.min(delayMs, deadline - nowInstant().epochMilliseconds), signal });
      const holder = await this.#holderOf(email);
      if (holder) {
        logger.info(
          { userId: holder.userId, grantId: holder.grantId },
          "granted the platform-operator role",
        );
        return;
      }
      delayMs = Math.min(delayMs * 2, this.wait.maxDelayMs);
    }
    logger.info(
      { email, waitedMs: this.wait.timeoutMs },
      "grant recorded; still being applied. It takes effect once the worker catches up",
    );
  }

  async #holderOf(email: string) {
    const wanted = email.toLowerCase();
    const holders = await this.operators.listPlatformOperators();
    return holders.find((holder) => holder.email?.toLowerCase() === wanted);
  }
}

function sleep({ ms, signal }: { ms: number; signal: AbortSignal }): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, Math.max(ms, 0));
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

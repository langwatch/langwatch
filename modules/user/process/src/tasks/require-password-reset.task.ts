import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import type { UserRepository } from "../repositories/user.repository.ts";
import {
  type PasswordResetRequirementReport,
  PasswordResetRequirementService,
  type PasswordResetSelector,
} from "../services/password-reset-requirement.service.ts";

const logger = createLogger("langwatch:task:require-password-reset");

const USAGE =
  "Say whom to mark: --all-credential-users, or --email <address> (repeatable, or comma separated). Add --dry-run to count without writing.";

/** Every address `--email <list>` and `--email=<list>` carry, in the order given. */
function emailArguments(args: readonly string[]): string[] {
  const lists = args.flatMap((arg, index) => {
    if (arg.startsWith("--email=")) return [arg.slice("--email=".length)];
    const next = args[index + 1];
    return arg === "--email" && next !== undefined ? [next] : [];
  });
  return lists.flatMap((list) => list.split(",")).filter((email) => email.trim() !== "");
}

/** Reads the selector from the task's arguments; refuses none, or both at once. */
export function parsePasswordResetSelector(args: readonly string[]): PasswordResetSelector {
  const everyone = args.includes("--all-credential-users");
  const emails = emailArguments(args);

  if (everyone && emails.length > 0) {
    throw new Error(`--all-credential-users and --email cannot be combined. ${USAGE}`);
  }
  if (everyone) return { kind: "all_credential_users" };
  if (emails.length > 0) return { kind: "emails", emails };
  throw new Error(USAGE);
}

/**
 * `pnpm --filter @langwatch/tasks task require-password-reset -- --all-credential-users`: marks
 * passwords as no longer trusted, so each person must choose a new one by reset link.
 */
export class RequirePasswordResetTask extends Task {
  readonly name = "require-password-reset";
  readonly description =
    "Marks users' passwords as requiring a reset before the next password sign-in. Pass --all-credential-users or --email <address>, and --dry-run to count only.";

  private constructor(private readonly users: UserRepository) {
    super();
  }

  static create({ users }: { users: UserRepository }): RequirePasswordResetTask {
    return new RequirePasswordResetTask(users);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await this.markForReset({ args });
  }

  async markForReset({
    args,
  }: {
    args: readonly string[];
  }): Promise<PasswordResetRequirementReport> {
    const selector = parsePasswordResetSelector(args);
    const report = await PasswordResetRequirementService.create({ users: this.users }).markForReset(
      { selector, dryRun: args.includes("--dry-run") },
    );
    logger.info(report, "finished marking passwords as requiring a reset");
    return report;
  }
}

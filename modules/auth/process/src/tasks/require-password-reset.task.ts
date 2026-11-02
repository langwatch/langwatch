import type { AuthApi } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import type { UserApi } from "@langwatch/user-contract";

import {
  type PasswordResetRequirementReport,
  PasswordResetRequirementService,
  type PasswordResetSelector,
} from "../services/password-reset-requirement.service.ts";

const logger = createLogger("langwatch:task:require-password-reset");

const USAGE =
  "Say whom to mark: --all-credential-users, or --email <address> (repeatable, or comma separated). Add --dry-run to count without writing.";

const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  "--all-credential-users",
  "--dry-run",
  "--email",
]);

/** Refuses any `--` argument it does not know, so a misspelled `--dry-run` never runs for real. */
function refuseUnknownFlags(args: readonly string[]): void {
  args.forEach((arg) => {
    if (arg === "--" || !arg.startsWith("--") || KNOWN_FLAGS.has(arg)) return;
    if (arg.startsWith("--email=")) return;
    throw new Error(`Unknown argument ${arg}. ${USAGE}`);
  });
}

/**
 * Every address `--email <list>` and `--email=<list>` carry, in the order given. An `--email`
 * with no address in it is refused, so it can never fall back to marking every user.
 */
function emailArguments(args: readonly string[]): string[] {
  return args.flatMap((arg, index) => {
    if (arg !== "--email" && !arg.startsWith("--email=")) return [];
    const operand = arg === "--email" ? args[index + 1] : arg.slice("--email=".length);
    const emails = (operand?.startsWith("--") ? "" : (operand ?? ""))
      .split(",")
      .filter((email) => email.trim() !== "");
    if (emails.length === 0) throw new Error(`--email needs an address. ${USAGE}`);
    return emails;
  });
}

/** Reads the selector from the task's arguments; refuses unknown flags, none, or both at once. */
export function parsePasswordResetSelector(args: readonly string[]): PasswordResetSelector {
  refuseUnknownFlags(args);
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
 * passwords as no longer trusted and ends the holders' browser sessions and CLI logins, so each
 * person must choose a new password by reset link.
 */
export class RequirePasswordResetTask extends Task {
  readonly name = "require-password-reset";
  readonly description =
    "Marks users' passwords as requiring a reset and ends their browser sessions and CLI logins. Pass --all-credential-users or --email <address>, and --dry-run to count only.";

  private constructor(
    private readonly users: Pick<UserApi, "findPasswordHolders" | "markPasswordResetRequired">,
    private readonly sessions: Pick<AuthApi, "revokeAllBrowserSessions" | "revokeCliTokens">,
  ) {
    super();
  }

  static create({
    users,
    sessions,
  }: {
    users: Pick<UserApi, "findPasswordHolders" | "markPasswordResetRequired">;
    sessions: Pick<AuthApi, "revokeAllBrowserSessions" | "revokeCliTokens">;
  }): RequirePasswordResetTask {
    return new RequirePasswordResetTask(users, sessions);
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
    const report = await PasswordResetRequirementService.create({
      users: this.users,
      sessions: this.sessions,
    }).markForReset({ selector, dryRun: args.includes("--dry-run") });
    logger.info(report, "finished marking passwords as requiring a reset");
    return report;
  }
}

/**
 * What `langwatch <tool>` does when setting up the direct-OTLP path
 * fails.
 *
 * The two wrapper paths are not interchangeable. Direct OTLP runs the
 * tool on the user's own subscription and sends LangWatch nothing but
 * telemetry; the gateway routes the model calls themselves through
 * LangWatch-held provider credentials and bills them. Switching from
 * the first to the second spends money the user never agreed to spend,
 * so the wrapper never does it on its own: the gateway is entered only
 * from the path prompt, a pinned `tool_mode`, or `--tool-mode=gateway`.
 *
 * That leaves the failure to handle honestly. An expired device session
 * is recoverable, so on a TTY the wrapper says so and offers the login
 * inline, then continues down the OTLP path the user picked. Anywhere
 * without a TTY it stops and names the command to run.
 */

import prompts from "prompts";

import { lwTag } from "./brand";
import { GovernanceCliError } from "./cli-api";
import type { GovernanceConfig } from "./config";
import { isLoggedIn } from "./config";
import { runDeviceFlowLogin } from "./login-flow";

/**
 * Why direct-OTLP setup failed, to the resolution this file cares about.
 *
 *   - `expired_session`: the control plane rejected the device session.
 *     A fresh login fixes it.
 *   - `tool_disabled`: the org admin turned both paths off for this
 *     tool. No login helps; the user needs their admin.
 *   - `other`: anything else (control plane unreachable, no personal
 *     workspace yet, mint refused).
 */
export type IngestionSetupFailureKind = "expired_session" | "tool_disabled" | "other";

export function classifyIngestionSetupError(err: unknown): IngestionSetupFailureKind {
  if (!(err instanceof GovernanceCliError)) return "other";
  if (err.code === "tool_disabled") return "tool_disabled";
  if (err.status === 401) return "expired_session";
  if (err.code === "unauthorized" || err.code === "not_logged_in") {
    return "expired_session";
  }
  return "other";
}

export type SessionRecovery =
  /** Logged in again; the caller should retry the OTLP path. */
  | { status: "recovered"; cfg: GovernanceConfig }
  /** Stop the run. `message` is already user-facing. */
  | { status: "abort"; message: string; exitCode: number };

export interface RecoverExpiredSessionOptions {
  cfg: GovernanceConfig;
  tool: string;
  /** TTY seam for tests. Defaults to stdin AND stdout being a TTY. */
  isTTY?: boolean;
  promptImpl?: typeof prompts;
  loginImpl?: typeof runDeviceFlowLogin;
  writeImpl?: (s: string) => void;
}

/** What happened, shared by the interactive and non-interactive branches. */
function expiredSessionIntro(tool: string): string {
  return (
    `${lwTag()} your LangWatch session expired, so direct OTLP telemetry for ` +
    `${tool} could not be set up.\n`
  );
}

/** The line every non-interactive caller gets, so the wording lives once. */
export function expiredSessionHelp(tool: string): string {
  return (
    expiredSessionIntro(tool) +
    `Run \`langwatch login --device\` to reconnect, then run this again.\n` +
    `${lwTag()} did not route ${tool} through the LangWatch gateway: that path ` +
    `bills model usage to your organization, and you did not pick it.\n`
  );
}

/**
 * Offer an inline re-login after an expired device session blocked the
 * direct-OTLP setup. Returns the refreshed config to retry with, or the
 * message and exit code the wrapper should stop on.
 */
export async function recoverExpiredSession(
  opts: RecoverExpiredSessionOptions,
): Promise<SessionRecovery> {
  const {
    cfg,
    tool,
    promptImpl = prompts,
    loginImpl = runDeviceFlowLogin,
    writeImpl = (s: string) => void process.stderr.write(s),
  } = opts;
  const isTTY =
    opts.isTTY ?? (Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY));

  if (!isTTY) {
    return { status: "abort", message: expiredSessionHelp(tool), exitCode: 1 };
  }

  writeImpl(
    expiredSessionIntro(tool) +
      `${lwTag()} staying on the path you picked: ${tool} keeps using your own ` +
      `plan, and nothing is billed through LangWatch.\n`,
  );

  const answer = await promptImpl({
    type: "confirm",
    name: "confirmed",
    message: "Log in to LangWatch again now?",
    initial: true,
  });

  if (answer?.confirmed !== true) {
    return {
      status: "abort",
      message:
        `${lwTag()} not logged in, so ${tool} was not started. Run ` +
        `\`langwatch login --device\` when you are ready.\n`,
      exitCode: 1,
    };
  }

  let next: GovernanceConfig;
  try {
    next = await loginImpl({ cfg });
  } catch (err) {
    return {
      status: "abort",
      message: `login failed: ${(err as Error).message ?? "unknown error"}\n`,
      exitCode: 1,
    };
  }
  if (!isLoggedIn(next)) {
    return {
      status: "abort",
      message: "login did not complete - exiting\n",
      exitCode: 1,
    };
  }
  return { status: "recovered", cfg: next };
}

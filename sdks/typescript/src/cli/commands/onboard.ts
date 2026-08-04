/**
 * `langwatch onboard` — get traces flowing with no account at all.
 *
 * Provisions a temporary workspace, writes the OTLP exporter into the
 * project's git-ignored Claude settings, and prints a QR the developer can
 * scan to keep the account. No gateway, no virtual key, no provider setup:
 * this is the path that works from nothing.
 *
 * There is no spawn here on purpose. Claude Code reads
 * `.claude/settings.local.json` itself, so writing the file *is* the delivery
 * mechanism — re-implementing the wrapper's careful TTY and signal handling to
 * inject the same variables would be duplication with nothing to show for it.
 */

import { claudeProjectSettingsTarget } from "../utils/governance/app-settings";
import { isSoloProfile, resolveProfileName } from "../utils/governance/profile";
import { resolveControlPlaneUrl } from "../utils/governance/resolveEndpoint";
import { renderClaimBlock } from "../utils/governance/terminal-qr";
import {
  conflictingExporter,
  ensureEphemeralAccount,
  installTelemetry,
  onboardingSummary,
} from "../utils/governance/zero-auth-onboarding";

export interface OnboardOptions {
  /** Which assistant to wire up. Only `claude` is wired today. */
  tool?: string;
  endpoint?: string;
  /** Rewire even when this directory already exports somewhere else. */
  force?: boolean;
  /** Injected in tests. */
  cwd?: string;
  write?: (text: string) => void;
  isAgent?: boolean;
  isInteractive?: boolean;
  columns?: number;
}

export interface OnboardResult {
  data: unknown;
  table: () => void;
}

/**
 * Returns a result rather than printing directly, so `-o json` gives an agent
 * the account it just provisioned — the ingestion key, the project, the
 * deadlines — instead of prose it would have to parse back out of a QR code.
 */
export async function onboardCommand(
  opts: OnboardOptions = {},
): Promise<OnboardResult | void> {
  const tool = opts.tool ?? "claude";
  const cwd = opts.cwd ?? process.cwd();
  const write = opts.write ?? ((t: string) => process.stdout.write(t));
  const endpoint = opts.endpoint ?? resolveControlPlaneUrl({});

  const target = claudeProjectSettingsTarget(cwd);

  // Resolve the account first so we never nag about a conflict and then fail
  // to get one anyway. Reuses the profile's existing account when there is
  // one, so re-running here does not provision a second workspace.
  const { provisioned, reused } = await ensureEphemeralAccount({
    endpoint,
    tool,
  });

  const conflict = conflictingExporter({
    target,
    otlpEndpoint: provisioned.ingestion.otlpEndpoint,
  });
  if (conflict && !opts.force) {
    // Somebody else's telemetry pipeline is not ours to redirect.
    write(
      `${target.displayPath} already exports OTLP to ${conflict}.\n` +
        `Re-run with --force to point it at LangWatch instead.\n`,
    );
    return;
  }

  installTelemetry({ tool, cwd, provisioned });

  const lines = [
    ...(reused
      ? [`Using this profile's temporary workspace: ${provisioned.account.projectName}`]
      : onboardingSummary({
          provisioned,
          settingsPath: target.displayPath,
        })),
    "",
    ...(await renderClaimBlock({
      url: provisioned.claim.url,
      context: {
        isAgent: opts.isAgent ?? false,
        isInteractive: opts.isInteractive ?? process.stdout.isTTY === true,
        columns: opts.columns ?? process.stdout.columns,
      },
    })),
  ];

  const profile = resolveProfileName();
  if (isSoloProfile(profile)) {
    lines.push("", `Scoped to this directory (profile ${profile}).`);
  }

  return {
    data: {
      profile,
      reused,
      account: provisioned.account,
      ingestion: {
        apiKey: provisioned.ingestion.apiKey,
        otlpEndpoint: provisioned.ingestion.otlpEndpoint,
      },
      claim: provisioned.claim,
      lifecycle: provisioned.lifecycle,
      settingsPath: target.displayPath,
    },
    table: () => write(`${lines.join("\n")}\n`),
  };
}

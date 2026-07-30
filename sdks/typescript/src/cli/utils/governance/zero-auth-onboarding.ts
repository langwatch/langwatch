/**
 * `npx langwatch claude` with no account at all.
 *
 * The gateway wrapper needs an org, a virtual key and configured providers,
 * and stops at "Not logged in" without them. This is the much smaller thing
 * that can run instead: no gateway, no virtual key, no provider setup — only
 * OTLP telemetry pointed at a temporary project the server provisions on the
 * spot. That is why it works from nothing, and why it does not replace the
 * gateway path for anyone who has one.
 */

import { createHash } from "node:crypto";
import * as os from "node:os";
import {
  type AppSettingsTarget,
  appEnvValues,
  claudeProjectSettingsTarget,
  installAppEnv,
} from "./app-settings";
import { buildOtelEnvBlock, SOURCE_TYPE_BY_TOOL } from "./otel-env-block";

/** The `POST /api/agent-onboarding/provision` response we consume. */
export interface ProvisionResult {
  account: {
    organizationId: string;
    projectId: string;
    projectSlug: string;
    projectName: string;
  };
  ingestion: {
    apiKey: string;
    keyPrefix: string;
    endpoint: string;
    otlpEndpoint: string;
  };
  claim: { token: string; url: string; claimableUntil: string };
  lifecycle: {
    state: string;
    provisionedAt: string;
    ingestionStopsAt: string | null;
    deleteAfter: string | null;
    daysRemainingInPhase: number | null;
  };
  notice: {
    dataRetention: string;
    claimWindow: string;
    afterExpiry: string;
  };
}

/**
 * A stable per-machine identifier, so one laptop cannot farm accounts by
 * moving between networks.
 *
 * Hashed before it leaves the machine: the server only ever needs equality,
 * and the raw hostname and username are nobody's business. The server peppers
 * it again on arrival, so neither side holds anything reversible.
 */
export function machineFingerprint(): string {
  const parts = [
    os.hostname(),
    os.userInfo().username,
    os.platform(),
    os.arch(),
  ];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export class ProvisioningFailedError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProvisioningFailedError";
  }
}

export async function provisionEphemeralAccount(params: {
  endpoint: string;
  /** Wrapper tool name, e.g. "claude". Mapped to the server's agent slug. */
  tool: string;
  fingerprint?: string;
  fetchImpl?: typeof fetch;
}): Promise<ProvisionResult> {
  const agent = SOURCE_TYPE_BY_TOOL[params.tool];
  if (!agent) {
    throw new ProvisioningFailedError(
      `No LangWatch onboarding is defined for \`${params.tool}\`.`,
    );
  }

  const base = params.endpoint.replace(/\/+$/, "");
  const f = params.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await f(`${base}/api/agent-onboarding/provision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-langwatch-fingerprint": params.fingerprint ?? machineFingerprint(),
      },
      body: JSON.stringify({ agent }),
    });
  } catch (err) {
    throw new ProvisioningFailedError(
      `Could not reach ${base}: ${(err as Error).message}`,
    );
  }

  if (!res.ok) {
    // The server's handled errors carry copy written for this exact moment —
    // rate limits, a disabled instance — so prefer it over anything invented
    // here, and fall back only when the body is not one.
    const detail = await readHandledMessage(res);
    throw new ProvisioningFailedError(
      detail ?? `Provisioning failed with HTTP ${res.status}.`,
      res.status,
    );
  }

  return (await res.json()) as ProvisionResult;
}

async function readHandledMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: unknown; tips?: unknown };
    const message = typeof body.message === "string" ? body.message : null;
    if (!message) return null;
    const tips = Array.isArray(body.tips)
      ? body.tips.filter((t): t is string => typeof t === "string")
      : [];
    return [message, ...tips].join("\n");
  } catch {
    return null;
  }
}

/**
 * Whether this directory's settings already export OTLP somewhere that is not
 * the endpoint we are about to write.
 *
 * Someone else's telemetry pipeline is not ours to redirect, so the caller
 * asks before overwriting it. An endpoint that already matches is not a
 * conflict — that is just a re-run.
 */
export function conflictingExporter(params: {
  target: AppSettingsTarget;
  otlpEndpoint: string;
}): string | null {
  const current = appEnvValues(params.target).OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!current) return null;
  if (current === params.otlpEndpoint) return null;
  return current;
}

/**
 * Write the exporter config for a provisioned account into the project's
 * git-ignored Claude settings.
 *
 * `.claude/settings.local.json` rather than `settings.json`: the block carries
 * an ingestion key, and the local file is the git-ignored half of the pair.
 */
export function installTelemetry(params: {
  tool: string;
  cwd: string;
  provisioned: ProvisionResult;
}): AppSettingsTarget {
  const target = claudeProjectSettingsTarget(params.cwd);
  installAppEnv(
    target,
    buildOtelEnvBlock(
      params.tool,
      params.provisioned.ingestion.otlpEndpoint,
      params.provisioned.ingestion.apiKey,
    ),
  );
  return target;
}

/**
 * The lines printed after provisioning.
 *
 * The deadline copy comes from the server rather than being composed here: a
 * self-hosted install can run different windows, and a CLI that hardcoded
 * "7 days" would confidently print a number its own server does not enforce.
 */
export function onboardingSummary(params: {
  provisioned: ProvisionResult;
  settingsPath: string;
}): string[] {
  const { provisioned, settingsPath } = params;
  return [
    `Created a temporary workspace — no signup needed.`,
    `  project   ${provisioned.account.projectName}`,
    `  telemetry ${settingsPath}`,
    "",
    provisioned.notice.dataRetention,
    provisioned.notice.claimWindow,
  ];
}

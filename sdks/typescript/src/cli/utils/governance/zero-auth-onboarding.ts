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
  type GovernanceConfig,
  loadConfig,
  saveConfig,
} from "./config";
import {
  type AppSettingsTarget,
  appEnvValues,
  claudeProjectSettingsTarget,
  installAppEnv,
} from "./app-settings";
import {
  assertUsableEndpoint,
  diagnoseFetchFailure,
} from "../networkError";
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
  // Fail on a malformed endpoint here rather than letting it become a
  // confusing transport error six frames down.
  assertUsableEndpoint(base);
  const f = params.fetchImpl ?? fetch;

  const url = `${base}/api/agent-onboarding/provision`;
  let res: Response;
  try {
    res = await f(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-langwatch-fingerprint": params.fingerprint ?? machineFingerprint(),
      },
      body: JSON.stringify({ agent }),
    });
  } catch (err) {
    // Names what actually went wrong and whose fault it is, instead of
    // re-printing `fetch failed`.
    throw diagnoseFetchFailure(err, url);
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

/**
 * Read a handled error into something worth printing.
 *
 * The API deliberately sends the CODE as `message` — a HandledError's own
 * message is server copy that can name env vars and internal hosts, so it
 * never leaves the building. Prose for humans rides in `tips`, which is the
 * channel authored for it. Printing `message` alone therefore yields
 * `rate_limited` and nothing else, which is exactly the useless error this
 * avoids.
 */
async function readHandledMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as {
      code?: unknown;
      message?: unknown;
      tips?: unknown;
      meta?: { retryAfterSeconds?: unknown };
    };
    const tips = Array.isArray(body.tips)
      ? body.tips.filter((t): t is string => typeof t === "string")
      : [];
    const code = typeof body.code === "string" ? body.code : null;
    const message = typeof body.message === "string" ? body.message : null;

    if (tips.length > 0) {
      // Lead with the guidance; keep the code as a trailing identifier so a
      // bug report can name the failure precisely.
      const head = tips[0]!;
      const rest = tips.slice(1).map((t) => `  ${t}`);
      return [head, ...rest, code ? `  (${code})` : ""]
        .filter(Boolean)
        .join("\n");
    }

    // No tips: fall back to whatever we have, but never present a bare code as
    // though it were a sentence.
    if (code && message === code) return `The server refused this: ${code}`;
    return message ?? code ?? null;
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

/**
 * The temporary account for this profile, provisioning one only if there is
 * not already a usable one stored.
 *
 * Reuse is the whole point of persisting it: provisioning afresh on every run
 * would burn the server's per-fingerprint rate limit within minutes and leave
 * a trail of abandoned workspaces. Bound to the control plane it came from, so
 * pointing the CLI at a different instance provisions there rather than
 * sending one instance's key to another.
 */
export async function ensureEphemeralAccount(params: {
  endpoint: string;
  tool: string;
  fetchImpl?: typeof fetch;
  loadImpl?: () => GovernanceConfig;
  saveImpl?: (cfg: GovernanceConfig) => void;
}): Promise<{ provisioned: ProvisionResult; reused: boolean }> {
  const load = params.loadImpl ?? loadConfig;
  const save = params.saveImpl ?? saveConfig;
  const endpoint = params.endpoint.replace(/\/+$/, "");

  const cfg = load();
  const stored = cfg.ephemeral_account;
  if (stored && stored.control_plane_url === endpoint) {
    return { provisioned: fromStored(stored), reused: true };
  }

  const provisioned = await provisionEphemeralAccount({
    endpoint,
    tool: params.tool,
    fetchImpl: params.fetchImpl,
  });

  save({
    ...cfg,
    ephemeral_account: {
      control_plane_url: endpoint,
      project_id: provisioned.account.projectId,
      project_slug: provisioned.account.projectSlug,
      project_name: provisioned.account.projectName,
      organization_id: provisioned.account.organizationId,
      ingestion_key: provisioned.ingestion.apiKey,
      otlp_endpoint: provisioned.ingestion.otlpEndpoint,
      claim_token: provisioned.claim.token,
      claim_url: provisioned.claim.url,
      delete_after: provisioned.lifecycle.deleteAfter,
    },
  });

  return { provisioned, reused: false };
}

/**
 * Rebuild the provisioning shape from what was persisted. The notice is not
 * stored — it is the server's copy about windows that may since have changed,
 * so a reused account simply does not re-print it rather than printing a
 * possibly stale sentence.
 */
function fromStored(
  stored: NonNullable<GovernanceConfig["ephemeral_account"]>,
): ProvisionResult {
  return {
    account: {
      organizationId: stored.organization_id,
      projectId: stored.project_id,
      projectSlug: stored.project_slug,
      projectName: stored.project_name,
    },
    ingestion: {
      apiKey: stored.ingestion_key,
      keyPrefix: stored.ingestion_key.slice(0, 12),
      endpoint: stored.control_plane_url,
      otlpEndpoint: stored.otlp_endpoint,
    },
    claim: {
      token: stored.claim_token,
      url: stored.claim_url,
      claimableUntil: stored.delete_after ?? "",
    },
    lifecycle: {
      state: "active",
      provisionedAt: "",
      ingestionStopsAt: null,
      deleteAfter: stored.delete_after ?? null,
      daysRemainingInPhase: null,
    },
    notice: { dataRetention: "", claimWindow: "", afterExpiry: "" },
  };
}

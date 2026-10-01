import { buildSdkIdentityHeaders } from "@/internal/api/request-headers";
/**
 * Session-authenticated calls that trade the device session for project
 * credentials, refreshing an expired token via `session-refresh.ts`. Only
 * a server rejection drops stored tokens; a network failure leaves them.
 */

import { normalizeEndpoint } from "../../../internal/endpoint";
import { type GovernanceConfig, loadConfig, saveConfig } from "./config";
import { createIngestionKey, DeviceFlowError, forkProjectSession, logout } from "./device-flow";
import { refreshSession as sharedRefreshSession } from "./session-refresh";

export interface SessionApiOptions {
  fetchImpl?: typeof fetch;
  /** Per-request deadline. Defaults to SESSION_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * Deadline on every session-authenticated request, including any token
 * refresh. Without a bound, a black-holed control plane would hang every
 * CLI command instead of letting the resolver fall back to the cached key.
 */
export const SESSION_REQUEST_TIMEOUT_MS = 10_000;

/** Wrap a fetch so requests carry a timeout signal unless the caller set one. */
const boundedFetch =
  (f: typeof fetch, timeoutMs: number): typeof fetch =>
  (input, init) =>
    f(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    });

export class SessionApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionApiError";
  }
}

/** Refresh margin: a token expiring within this window is treated as expired. */
const EXPIRY_MARGIN_SECONDS = 30;

function isExpired(cfg: GovernanceConfig): boolean {
  if (!cfg.expires_at) return false;
  return cfg.expires_at <= Math.floor(Date.now() / 1000) + EXPIRY_MARGIN_SECONDS;
}

/**
 * Rotates the stored token pair via POST /api/auth/cli/refresh. Returns
 * false when revoked or unrefreshable, clearing the dead tokens (and tied
 * personal project cache) so `isLoggedIn` honestly reports logged-out.
 */
async function refreshSession(cfg: GovernanceConfig, opts: SessionApiOptions): Promise<boolean> {
  const outcome = await sharedRefreshSession(cfg, {
    fetchImpl: boundedFetch(opts.fetchImpl ?? fetch, opts.timeoutMs ?? SESSION_REQUEST_TIMEOUT_MS),
  });
  if (outcome.status === "refreshed") return true;

  // Only a server rejection means the session is genuinely gone. Rotation is
  // single-use, so the shared refresh already re-read and retried with a
  // sibling's persisted tokens before reporting this -- clearing now can't
  // wipe a live token. A network failure clears nothing.
  if (outcome.status === "rejected") {
    delete cfg.access_token;
    delete cfg.refresh_token;
    delete cfg.expires_at;
    delete cfg.personal_project;
    saveConfig(cfg);
  }
  return false;
}

/**
 * One session-authenticated request with a single refresh-and-retry on an
 * expired or rejected access token. Mutates and persists `cfg` when tokens
 * rotate, so callers holding the same object keep working with it.
 */
async function sessionRequest(
  cfg: GovernanceConfig,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  opts: SessionApiOptions,
): Promise<Response> {
  if (!cfg.access_token) {
    throw new SessionApiError(401, "not_logged_in", "Not logged in");
  }
  if (isExpired(cfg)) {
    await refreshSession(cfg, opts);
  }
  const f = boundedFetch(opts.fetchImpl ?? fetch, opts.timeoutMs ?? SESSION_REQUEST_TIMEOUT_MS);
  const doFetch = () =>
    f(normalizeEndpoint(cfg.control_plane_url) + path, {
      method,
      headers: {
        ...buildSdkIdentityHeaders({ surface: "cli" }),
        Authorization: `Bearer ${cfg.access_token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  let res = await doFetch();
  if (res.status === 401 && (await refreshSession(cfg, opts))) {
    res = await doFetch();
  }
  return res;
}

export interface SessionPersonalProject {
  id: string;
  slug: string;
  name: string;
  /** Sent only by servers before project sessions; the login key authenticates instead. */
  api_key?: string;
}

/**
 * The personal project, read through the device session, which also proves the session live.
 * Returns null when the server predates the endpoint (404); throws SessionApiError on auth
 * failures and server errors.
 */
export async function fetchPersonalProject(
  cfg: GovernanceConfig = loadConfig(),
  opts: SessionApiOptions = {},
): Promise<SessionPersonalProject | null> {
  const res = await sessionRequest(cfg, "GET", "/api/auth/cli/personal-project", undefined, opts);
  if (res.status === 404) return null;
  if (res.status === 401) {
    throw new SessionApiError(
      401,
      "unauthorized",
      "Session expired or revoked. Run `langwatch login` again.",
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SessionApiError(
      res.status,
      "server_error",
      `personal-project exchange failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const parsed = (await res.json()) as { project?: SessionPersonalProject };
  if (!parsed.project?.id) {
    throw new SessionApiError(
      500,
      "malformed_response",
      "personal-project exchange returned no project",
    );
  }
  return parsed.project;
}

export interface SessionProjectKey {
  api_key: string;
  project: { id: string; slug: string; name: string };
}

/**
 * Non-interactive project login: forks a child session capped at the project from the device
 * session, mints this machine's ingestion key with it, then ends the child. The device session
 * itself is left as it was.
 */
export async function mintProjectIngestionKey(
  cfg: GovernanceConfig,
  slug: string,
  opts: SessionApiOptions = {},
): Promise<SessionProjectKey> {
  if (!cfg.refresh_token) {
    throw new SessionApiError(401, "not_logged_in", "Not logged in");
  }
  const flow = {
    baseUrl: cfg.control_plane_url,
    fetchImpl: boundedFetch(opts.fetchImpl ?? fetch, opts.timeoutMs ?? SESSION_REQUEST_TIMEOUT_MS),
  };
  try {
    const child = await forkProjectSession(flow, {
      refreshToken: cfg.refresh_token,
      projectSlug: slug,
    });
    const { project } = child;
    if (!project) {
      // An older server rotated the device session instead: keep the new pair, mint nothing.
      cfg.access_token = child.access_token;
      cfg.refresh_token = child.refresh_token;
      cfg.expires_at = Math.floor(Date.now() / 1000) + child.expires_in;
      saveConfig(cfg);
      throw new SessionApiError(
        404,
        "endpoint_missing",
        "This LangWatch server does not support project login from the command line yet. Update LangWatch, or use `langwatch login --api-key <key>`.",
      );
    }
    try {
      const apiKey = await createIngestionKey(flow, { accessToken: child.access_token, project });
      return { api_key: apiKey, project };
    } finally {
      await logout(flow, child.refresh_token, child.access_token).catch(() => undefined);
    }
  } catch (error) {
    throw sessionApiErrorOf({ error, slug });
  }
}

/** The device flow's refusal, in the codes the project-login callers branch on. */
function sessionApiErrorOf({ error, slug }: { error: unknown; slug: string }): unknown {
  if (!(error instanceof DeviceFlowError)) return error;
  if (error.kind === "unauthorized") {
    return new SessionApiError(
      401,
      "unauthorized",
      "Session expired or revoked. Run `langwatch login` again.",
    );
  }
  if (error.kind === "denied") {
    return new SessionApiError(
      403,
      "project_not_found",
      `No project "${slug}" you can send traces to: ${error.message}`,
    );
  }
  return new SessionApiError(500, "error", error.message);
}

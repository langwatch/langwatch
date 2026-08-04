/**
 * Session-authenticated calls that trade the device session for project
 * credentials:
 *
 *   - `fetchPersonalProject`   - GET /api/auth/cli/personal-project, the lazy
 *     personal-key exchange for sessions minted before /exchange shipped
 *     `personal_project`. Called at most once per session by the credential
 *     resolver, which persists the result into ~/.langwatch/config.json.
 *   - `fetchProjectKeyBySlug`  - POST /api/auth/cli/project-key, the
 *     non-interactive `langwatch login --project <slug>` path for headless
 *     contexts. Returns the named project's EXISTING key; nothing is minted.
 *
 * Both refresh an expired access token once (rotating the stored pair) before
 * giving up, because access tokens live one hour and these calls typically
 * happen days after login. The rotation itself goes through
 * `session-refresh.ts`, the one implementation shared with `cli-api.ts`, so
 * concurrent CLI processes racing over a single-use refresh token resolve the
 * same way here as everywhere else. Only a server rejection drops the stored
 * tokens, so the next command reports "not logged in" instead of retrying a
 * dead session forever; a network failure leaves them alone.
 *
 * Spec: specs/ai-governance/cli-onboarding/me-credentials.feature
 */

import { trimTrailingSlashes } from "../../../internal/url";
import {
  type GovernanceConfig,
  loadConfig,
  saveConfig,
} from "./config";
import { refreshSession as sharedRefreshSession } from "./session-refresh";

export interface SessionApiOptions {
  fetchImpl?: typeof fetch;
  /** Per-request deadline. Defaults to SESSION_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * Deadline on every session-authenticated request (including the token
 * refresh it may perform). The credential resolver awaits these calls on
 * every command once the revalidation window lapses; without a bound, a
 * black-holed control plane would hang every CLI command instead of letting
 * the resolver fall back to the cached key.
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
 * Rotate the stored token pair via POST /api/auth/cli/refresh and persist it.
 * Returns false when the session is revoked or unrefreshable, in which case
 * the dead tokens (and the personal project cache tied to them) are cleared
 * so `isLoggedIn` honestly reports logged-out from here on.
 */
async function refreshSession(
  cfg: GovernanceConfig,
  opts: SessionApiOptions,
): Promise<boolean> {
  const outcome = await sharedRefreshSession(cfg, {
    fetchImpl: boundedFetch(
      opts.fetchImpl ?? fetch,
      opts.timeoutMs ?? SESSION_REQUEST_TIMEOUT_MS,
    ),
  });
  if (outcome.status === "refreshed") return true;

  // Only a server rejection means the session is genuinely gone. Rotation is
  // single-use, so a sibling CLI process that refreshed first would otherwise
  // look like a revocation from here; the shared refresh already re-read the
  // config and retried with whatever the sibling persisted before reporting
  // this, so clearing now cannot wipe a live token. A network failure clears
  // nothing: the tokens may be perfectly good.
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
  const f = boundedFetch(
    opts.fetchImpl ?? fetch,
    opts.timeoutMs ?? SESSION_REQUEST_TIMEOUT_MS,
  );
  const doFetch = () =>
    f(trimTrailingSlashes(cfg.control_plane_url) + path, {
      method,
      headers: {
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
  api_key: string;
}

/**
 * Lazy personal-key exchange. Returns null when the server predates the
 * endpoint (404) so the caller can degrade gracefully; throws SessionApiError
 * on auth failures and server errors.
 */
export async function fetchPersonalProject(
  cfg: GovernanceConfig = loadConfig(),
  opts: SessionApiOptions = {},
): Promise<SessionPersonalProject | null> {
  const res = await sessionRequest(
    cfg,
    "GET",
    "/api/auth/cli/personal-project",
    undefined,
    opts,
  );
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
  if (!parsed.project?.api_key) {
    throw new SessionApiError(
      500,
      "malformed_response",
      "personal-project exchange returned no api_key",
    );
  }
  return parsed.project;
}

export interface SessionProjectKey {
  api_key: string;
  project: { id: string; slug: string; name: string };
}

/**
 * Non-interactive project login: resolve a shared project's existing API key
 * by slug through the device session. Server enforces write access and
 * refuses other users' personal projects; the error_description is carried
 * through so the CLI can show the server's own sentence.
 */
export async function fetchProjectKeyBySlug(
  cfg: GovernanceConfig,
  slug: string,
  opts: SessionApiOptions = {},
): Promise<SessionProjectKey> {
  const res = await sessionRequest(
    cfg,
    "POST",
    "/api/auth/cli/project-key",
    { slug },
    opts,
  );
  if (res.status === 401) {
    throw new SessionApiError(
      401,
      "unauthorized",
      "Session expired or revoked. Run `langwatch login` again.",
    );
  }
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as {
      error_description?: string;
      error?: string;
    };
    // Distinguish "no such project" from "server predates the endpoint":
    // the endpoint answers with a JSON error envelope, an older server's
    // framework 404 does not carry our error code.
    if (body.error === "not_found") {
      throw new SessionApiError(
        404,
        "project_not_found",
        body.error_description ?? `No project with slug "${slug}"`,
      );
    }
    throw new SessionApiError(
      404,
      "endpoint_missing",
      "This LangWatch server does not support non-interactive project login yet. Run `langwatch login --project` in a terminal with a browser instead.",
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    throw new SessionApiError(
      res.status,
      body.error ?? "error",
      body.error_description ?? `project-key request failed (${res.status})`,
    );
  }
  // Same guard as fetchPersonalProject: a 200 with no key must fail loudly
  // here, or the caller writes `LANGWATCH_API_KEY=undefined` into .env and
  // reports success.
  const parsed = (await res
    .json()
    .catch(() => null)) as SessionProjectKey | null;
  if (!parsed?.api_key) {
    throw new SessionApiError(
      500,
      "malformed_response",
      "project-key exchange returned no api_key",
    );
  }
  return parsed;
}

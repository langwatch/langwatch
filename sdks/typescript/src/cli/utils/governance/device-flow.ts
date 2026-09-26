/**
 * RFC 8628 device-code OAuth client for `langwatch login --device`, hitting the control plane's
 * `/api/auth/cli/*` endpoints (documented in
 * `docs/ai-gateway/governance/admin-setup.mdx#cli-device-flow-rest-api`).
 */

import * as os from "node:os";
import { setTimeout as wait } from "node:timers/promises";

import { normalizeEndpoint } from "../../../internal/endpoint";

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface ExchangeUser {
  id: string;
  email: string;
  name: string;
}

export interface ExchangeOrganization {
  id: string;
  slug?: string;
  name: string;
}

export interface ExchangePersonalVK {
  id: string;
  secret: string;
  prefix?: string;
}

export interface ExchangeProject {
  id: string;
  slug: string;
  name: string;
}

/**
 * Shipped on device-session exchanges so data commands can authenticate
 * without an env var. Older servers omit it; the CLI then lazily exchanges
 * via `GET /api/auth/cli/personal-project` on first use.
 */
export interface ExchangePersonalProject {
  id: string;
  slug: string;
  name: string;
  api_key: string;
}

/**
 * What the minted `cli_api_key` reaches. `organization` covers every project
 * of the organization and carries an empty `project_ids`; `projects` names the
 * exact ids the user picked on the authorize screen.
 */
export interface ExchangeCliApiKeyScope {
  kind: "organization" | "projects";
  project_ids: string[];
  /**
   * The permission slugs the key was minted with. Absent on servers that
   * predate the field; `whoami` then reports only the reach.
   */
  permissions?: string[];
}

/**
 * "device_session": user-scoped OAuth token pair, for the `claude`/`codex`
 * wrappers. "project_api_key": the project-scoped SDK key verbatim. Same
 * approval ceremony for both; only the persist target differs.
 */
export type CredentialType = "device_session" | "project_api_key";

export interface ExchangeDeviceSessionResult {
  kind: "device_session";
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: ExchangeUser;
  organization: ExchangeOrganization;
  default_personal_vk?: ExchangePersonalVK;
  personal_project?: ExchangePersonalProject;
  /**
   * The user-scoped API key minted for this login, reaching every project the
   * user selected while approving. Absent on servers that predate the feature,
   * and the CLI then authenticates with the personal project's own key.
   */
  cli_api_key?: string;
  cli_api_key_scope?: ExchangeCliApiKeyScope;
  endpoint?: string;
}

export interface ExchangeApiKeyResult {
  kind: "api_key";
  api_key: string;
  project: ExchangeProject;
  user: ExchangeUser;
  organization: ExchangeOrganization;
  endpoint?: string;
}

export type ExchangeResult = ExchangeDeviceSessionResult | ExchangeApiKeyResult;

/**
 * Back-compat: pre-`f9fcc3927` servers returned this shape unkinded; the
 * runtime normaliser below maps it to `{ kind: 'device_session', ... }` so
 * callers can always assume the discriminated form.
 */
export type LegacyExchangeResult = Omit<ExchangeDeviceSessionResult, "kind"> & {
  kind?: "device_session";
};

export interface RefreshResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class DeviceFlowError extends Error {
  constructor(
    public readonly kind: "pending" | "denied" | "expired" | "slow_down" | "unauthorized" | "other",
    message: string,
  ) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

export interface DeviceFlowOptions {
  /** Control-plane base URL (e.g. https://app.langwatch.ai). */
  baseUrl: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * `POST /api/auth/cli/device-code` — mint a device-code + user-code pair.
 * Optional `credentialType` selects what `/exchange` returns: a user-scoped
 * device session (default) or a project-scoped API key.
 */
export async function startDeviceCode(
  opts: DeviceFlowOptions,
  init: { credentialType?: CredentialType; teamManagement?: boolean } = {},
): Promise<DeviceCode> {
  const body: Record<string, unknown> = {};
  if (init.credentialType) body.credential_type = init.credentialType;
  // Sent only when asked, so a login without --manage-teams reads exactly as
  // it did before the flag existed.
  if (init.teamManagement) body.team_management = true;
  const dc = await postJSON<DeviceCode>(opts, "/api/auth/cli/device-code", body);
  if (!dc.interval || dc.interval <= 0) dc.interval = 5;
  return dc;
}

/**
 * Fingerprint stamped on the CLI session so /me/devices can render "Mac
 * (rchaves.local)" and one device can be revoked without logging out every
 * device. Contract: `auth-cli-device-flow.api.ts#clientInfoSchema`.
 */
function collectClientInfo(): {
  hostname: string;
  uname: string;
  platform: string;
} {
  let hostname = "";
  let uname = "";
  try {
    hostname = os.hostname();
  } catch {
    // os.hostname() can throw on locked-down sandboxes; carry empty.
    void 0;
  }
  try {
    uname = os.userInfo().username;
  } catch {
    // os.userInfo() throws when the uid has no /etc/passwd entry
    // (some Docker images, CI sandboxes); carry empty.
    void 0;
  }
  return { hostname, uname, platform: process.platform };
}

/**
 * `POST /api/auth/cli/exchange` — single poll. Returns the token bundle on
 * success (200), or throws `DeviceFlowError` with a `kind` so the caller
 * can decide whether to keep polling or stop.
 */
export async function exchange(
  opts: DeviceFlowOptions,
  deviceCode: string,
): Promise<ExchangeResult> {
  const res = await rawPost(opts, "/api/auth/cli/exchange", {
    device_code: deviceCode,
    client_info: collectClientInfo(),
  });
  switch (res.status) {
    case 200: {
      const body = (await res.json()) as ExchangeResult | LegacyExchangeResult;
      // Pre-f9fcc3927 servers returned the device-session shape without
      // a `kind` field. Normalise so callers can always discriminate.
      if (!("kind" in body) || !body.kind) {
        return { kind: "device_session", ...body };
      }
      return body as ExchangeResult;
    }
    case 428:
      throw new DeviceFlowError("pending", "authorization pending");
    case 410:
      throw new DeviceFlowError("denied", "authorization denied");
    case 408:
      throw new DeviceFlowError("expired", "authorization request expired");
    case 429:
      throw new DeviceFlowError("slow_down", "polling too fast");
    default: {
      const body = await res.text().catch(() => "");
      throw new DeviceFlowError("other", `unexpected status ${res.status}: ${body.slice(0, 256)}`);
    }
  }
}

/**
 * `GET /api/auth/cli/device-approval` — emits one frame when the browser
 * approves/denies (no credential, just "poll now"); never resolves otherwise,
 * so an old server or dropped connection leaves the poll timer in charge.
 */
function watchDeviceApproval({
  opts,
  deviceCode,
}: {
  opts: DeviceFlowOptions;
  deviceCode: string;
}): { settled: Promise<void>; close: () => void } {
  const controller = new AbortController();
  const settled = new Promise<void>((resolve) => {
    readApprovalStream({ opts, deviceCode, signal: controller.signal })
      .then((sawFrame) => {
        if (sawFrame) resolve();
      })
      .catch(() => {
        // Never settles: polling stays in charge.
      });
  });
  return { settled, close: () => controller.abort() };
}

/** Whether the approval stream delivered a frame before it ended. */
async function readApprovalStream({
  opts,
  deviceCode,
  signal,
}: {
  opts: DeviceFlowOptions;
  deviceCode: string;
  /** Aborts the read once the login is over, so the socket is not left open. */
  signal: AbortSignal;
}): Promise<boolean> {
  const base = normalizeEndpoint(opts.baseUrl);
  const f = opts.fetchImpl ?? fetch;
  const res = await f(
    `${base}/api/auth/cli/device-approval?device_code=${encodeURIComponent(deviceCode)}`,
    {
      headers: { Accept: "text/event-stream", Origin: base },
      signal,
    },
  );
  if (!res.ok || !res.body) return false;

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return false;
      buffered += decoder.decode(value, { stream: true });
      // Any data frame means "the code settled, poll now". The payload does
      // not decide anything: /exchange is what says approved or denied.
      if (/^data:.*\S/m.test(buffered)) return true;
    }
  } finally {
    void reader.cancel().catch(() => {
      // The stream is already going away.
    });
  }
}

/** Sleep, cut short by the approval signal when one is still worth racing. */
async function waitForNextPoll({
  ms,
  approval,
}: {
  ms: number;
  approval: Promise<void> | null;
}): Promise<void> {
  if (!approval) {
    await wait(ms);
    return;
  }
  const timer = new AbortController();
  try {
    await Promise.race([
      wait(ms, undefined, { signal: timer.signal }).catch(() => {
        // Aborted because the approval landed first.
      }),
      approval,
    ]);
  } finally {
    timer.abort();
  }
}

/**
 * Poll `exchange` until approved, denied, or expired — honouring RFC 8628
 * §3.5 by doubling the interval on `slow_down`. The approval stream also
 * cuts a wait short the moment the browser settles the code.
 */
export async function pollUntilDone(
  opts: DeviceFlowOptions,
  dc: DeviceCode,
): Promise<ExchangeResult> {
  let interval = dc.interval * 1000;
  const ceiling = 60_000;
  const deadline = Date.now() + dc.expires_in * 1000;

  const watch = watchDeviceApproval({ opts, deviceCode: dc.device_code });
  const approval = watch.settled;
  // A signal fires once, tracked in two flags: `signalled` (frame arrived) and
  // `spent` (already let one poll through for it) — a frame during an in-flight
  // exchange still shortens the next wait, and `spent` stops the loop racing
  // an already-resolved promise into a hot poll.
  const signal = { signalled: false, spent: false };
  void approval.then(() => {
    signal.signalled = true;
  });

  try {
    let firstPoll = true;
    for (;;) {
      if (Date.now() > deadline) {
        throw new DeviceFlowError("expired", "authorization request expired");
      }
      if (firstPoll) {
        firstPoll = false;
      } else {
        await waitForDevicePoll(interval, approval, signal);
      }

      try {
        return await exchange(opts, dc.device_code);
      } catch (err) {
        interval = nextPollInterval(err, interval, ceiling);
      }
    }
  } finally {
    watch.close();
  }
}

/**
 * `POST /api/auth/cli/refresh` — rotate access and refresh tokens.
 * 401 means the refresh token has been revoked server-side (admin
 * disable / off-boarding); the caller should clear local state.
 */
export async function refresh(
  opts: DeviceFlowOptions,
  refreshToken: string,
): Promise<RefreshResult> {
  const res = await rawPost(opts, "/api/auth/cli/refresh", {
    refresh_token: refreshToken,
  });
  if (res.status === 401) {
    throw new DeviceFlowError("unauthorized", "session revoked — re-authenticate");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DeviceFlowError("other", `refresh failed (${res.status}): ${body.slice(0, 256)}`);
  }
  return (await res.json()) as RefreshResult;
}

/**
 * `POST /api/auth/cli/logout` — revokes the refresh token AND its paired
 * access token (per `e7a042c69`: a stolen access token used to survive
 * logout for up to 1h; sending both closes the gap). Idempotent.
 */
export async function logout(
  opts: DeviceFlowOptions,
  refreshToken: string,
  accessToken?: string,
): Promise<void> {
  const body: Record<string, string> = { refresh_token: refreshToken };
  if (accessToken) body.access_token = accessToken;
  const res = await rawPost(opts, "/api/auth/cli/logout", body);
  // 401/404 mean "already gone" — that's success for logout.
  if (res.status === 200 || res.status === 401 || res.status === 404) return;
  const text = await res.text().catch(() => "");
  throw new DeviceFlowError("other", `logout failed (${res.status}): ${text.slice(0, 256)}`);
}

async function postJSON<T>(opts: DeviceFlowOptions, path: string, body: unknown): Promise<T> {
  const res = await rawPost(opts, path, body);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new DeviceFlowError("other", `${path} → ${res.status}: ${text.slice(0, 256)}`);
  }
  return (await res.json()) as T;
}

function rawPost(opts: DeviceFlowOptions, path: string, body: unknown): Promise<Response> {
  const url = normalizeEndpoint(opts.baseUrl) + path;
  const f = opts.fetchImpl ?? fetch;
  return f(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // Origin enforcement on the server requires this for non-browser
      // clients. The base URL is the same as the control plane, so
      // mirroring it as Origin satisfies the same-origin gate.
      Origin: normalizeEndpoint(opts.baseUrl),
    },
    body: JSON.stringify(body ?? {}),
  });
}

function nextPollInterval(error: unknown, interval: number, ceiling: number): number {
  if (!(error instanceof DeviceFlowError)) throw error;
  if (error.kind === "pending") return interval;
  if (error.kind === "slow_down") return Math.min(interval * 2, ceiling);
  throw error;
}

async function waitForDevicePoll(
  interval: number,
  approval: Promise<void>,
  signal: { signalled: boolean; spent: boolean },
): Promise<void> {
  // An approval arriving during an exchange skips exactly one wait.
  if (signal.signalled && !signal.spent) {
    signal.spent = true;
    return;
  }
  await waitForNextPoll({ ms: interval, approval: signal.spent ? null : approval });
  if (signal.signalled) signal.spent = true;
}

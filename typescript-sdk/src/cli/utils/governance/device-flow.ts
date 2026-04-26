/**
 * RFC 8628 device-code OAuth client for the `langwatch login --device`
 * flow. Targets the control plane's `/api/auth/cli/*` endpoints —
 * the same wire surface a custom CLI client would hit (documented in
 * `docs/ai-gateway/governance/admin-setup.mdx#cli-device-flow-rest-api`).
 *
 * Pure stdlib `fetch`, no axios — matches the rest of the typescript
 * CLI's HTTP style.
 */

import { setTimeout as wait } from "node:timers/promises";

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

export interface ExchangeResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: ExchangeUser;
  organization: ExchangeOrganization;
  default_personal_vk?: ExchangePersonalVK;
}

export interface RefreshResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class DeviceFlowError extends Error {
  constructor(public readonly kind: "pending" | "denied" | "expired" | "slow_down" | "unauthorized" | "other", message: string) {
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
 */
export async function startDeviceCode(opts: DeviceFlowOptions): Promise<DeviceCode> {
  const dc = await postJSON<DeviceCode>(opts, "/api/auth/cli/device-code", {});
  if (!dc.interval || dc.interval <= 0) dc.interval = 5;
  return dc;
}

/**
 * `POST /api/auth/cli/exchange` — single poll. Returns the access+refresh
 * token bundle on success (200), or throws DeviceFlowError with a
 * categorised `kind` so the caller can decide whether to keep polling
 * (`pending`, `slow_down`) or stop (`denied`, `expired`).
 */
export async function exchange(
  opts: DeviceFlowOptions,
  deviceCode: string,
): Promise<ExchangeResult> {
  const res = await rawPost(opts, "/api/auth/cli/exchange", { device_code: deviceCode });
  switch (res.status) {
    case 200:
      return (await res.json()) as ExchangeResult;
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
 * Poll `exchange` at the cadence the server requested until the user
 * approves, denies, or the device-code expires. Honours RFC 8628 §3.5
 * by doubling the polling interval on `slow_down` responses.
 */
export async function pollUntilDone(
  opts: DeviceFlowOptions,
  dc: DeviceCode,
): Promise<ExchangeResult> {
  let interval = dc.interval * 1000;
  const ceiling = 60_000;
  const deadline = Date.now() + dc.expires_in * 1000;

  for (;;) {
    if (Date.now() > deadline) {
      throw new DeviceFlowError("expired", "authorization request expired");
    }
    await wait(interval);
    try {
      return await exchange(opts, dc.device_code);
    } catch (err) {
      if (!(err instanceof DeviceFlowError)) throw err;
      if (err.kind === "pending") continue;
      if (err.kind === "slow_down") {
        interval = Math.min(interval * 2, ceiling);
        continue;
      }
      throw err;
    }
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
  const res = await rawPost(opts, "/api/auth/cli/refresh", { refresh_token: refreshToken });
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
 * `POST /api/auth/cli/logout` — server-side revoke a refresh token.
 * Idempotent (200 on already-revoked / unknown tokens).
 */
export async function logout(
  opts: DeviceFlowOptions,
  refreshToken: string,
): Promise<void> {
  const res = await rawPost(opts, "/api/auth/cli/logout", { refresh_token: refreshToken });
  // 401/404 mean "already gone" — that's success for logout.
  if (res.status === 200 || res.status === 401 || res.status === 404) return;
  const body = await res.text().catch(() => "");
  throw new DeviceFlowError("other", `logout failed (${res.status}): ${body.slice(0, 256)}`);
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
  const url = opts.baseUrl.replace(/\/+$/, "") + path;
  const f = opts.fetchImpl ?? fetch;
  return f(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // Origin enforcement on the server requires this for non-browser
      // clients. The base URL is the same as the control plane, so
      // mirroring it as Origin satisfies the same-origin gate.
      Origin: opts.baseUrl.replace(/\/+$/, ""),
    },
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * Lets a voice worker discover its own public HTTPS base URL at boot by
 * opening a free cloudflared "quick tunnel", instead of requiring
 * VOICE_PUBLIC_BASE_URL to be configured ahead of time. Deliberately
 * temporary/ephemeral infrastructure - a `*.trycloudflare.com` URL is torn
 * down and re-minted on every worker restart.
 *
 * Reuses the SDK's `openTwilioTunnel` (cloudflared provider) rather than
 * re-spawning cloudflared here: `@langwatch/scenario` exports it from its
 * package root (verified against the installed dist,
 * `node_modules/@langwatch/scenario/package.json` version 1.7.0-dev.voice6,
 * `dist/index.mjs` line ~5530: `openTwilioTunnel: () => openTwilioTunnel`) -
 * the same helper the JS a-leg e2e test uses to open its own quick tunnel.
 *
 * A fresh `*.trycloudflare.com` hostname is NOT immediately globally
 * resolvable, and Twilio dials it within seconds of a call being placed, so
 * this module does not report the tunnel ready until the hostname actually
 * resolves publicly. This mirrors the `TunnelReadiness` gate the SDK's Twilio
 * a-leg e2e test builds for the same reason (`edgeReadiness` in
 * `twilio-a-leg-external.e2e.test.ts`) - that helper is test-local and not
 * exported, so the readiness wait is reimplemented here, with the DNS check
 * injectable so tests stay hermetic (no real network, no real cloudflared).
 */

import { resolve4 } from "node:dns/promises";
import { openTwilioTunnel, type OpenedTunnel } from "@langwatch/scenario";

/** How long to wait for the fresh hostname to become globally resolvable. */
export const TUNNEL_READY_TIMEOUT_MS_DEFAULT = 60_000;
/** Delay between resolution attempts while DNS propagates. */
const POLL_INTERVAL_MS_DEFAULT = 1_000;

/** A live voice public-URL tunnel: its public origin and a teardown. */
export interface VoicePublicUrlTunnel {
  /** The public https origin Twilio (or any caller) dials back. */
  url: string;
  close(): Promise<void>;
}

/** Thrown when the tunnel's hostname never became globally resolvable. */
export class VoiceTunnelNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceTunnelNotReadyError";
  }
}

/** Extract the bare host from a `https://host[/path]` URL. */
export function tunnelHostFromUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

/** Resolve `host`'s A record; true once anything answers. Default resolver. */
async function defaultResolveHost(host: string): Promise<boolean> {
  try {
    const answers = await resolve4(host);
    return answers.length > 0;
  } catch {
    return false;
  }
}

/**
 * Poll `resolveHost` until `url`'s host resolves, or throw
 * {@link VoiceTunnelNotReadyError} once `timeoutMs` elapses. Exported
 * separately from {@link openVoicePublicUrlTunnel} so the readiness gate can
 * be unit-tested without opening a real tunnel.
 */
export async function waitUntilTunnelResolvable(params: {
  url: string;
  resolveHost?: (host: string) => Promise<boolean>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const resolveHost = params.resolveHost ?? defaultResolveHost;
  const timeoutMs = params.timeoutMs ?? TUNNEL_READY_TIMEOUT_MS_DEFAULT;
  const pollIntervalMs = params.pollIntervalMs ?? POLL_INTERVAL_MS_DEFAULT;
  const host = tunnelHostFromUrl(params.url);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await resolveHost(host)) return;
    if (Date.now() >= deadline) {
      throw new VoiceTunnelNotReadyError(
        `voice public URL tunnel ${params.url} did not become globally resolvable within ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * Open a cloudflared quick tunnel to `port` and wait until it is globally
 * resolvable. Throws (after closing the tunnel) if it never becomes
 * reachable within `timeoutMs` - a call dialled into an unresolvable tunnel
 * fails silently with a ~1 second duration, so failing fast at boot is the
 * cheaper failure.
 */
export async function openVoicePublicUrlTunnel(params: {
  port: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  openTunnel?: (opts: {
    port: number;
    provider: "cloudflared";
  }) => Promise<OpenedTunnel>;
  resolveHost?: (host: string) => Promise<boolean>;
}): Promise<VoicePublicUrlTunnel> {
  const openTunnel = params.openTunnel ?? openTwilioTunnel;
  const tunnel = await openTunnel({
    port: params.port,
    provider: "cloudflared",
  });
  try {
    await waitUntilTunnelResolvable({
      url: tunnel.url,
      resolveHost: params.resolveHost,
      timeoutMs: params.timeoutMs,
      pollIntervalMs: params.pollIntervalMs,
    });
  } catch (error) {
    await tunnel.close();
    throw error;
  }
  return { url: tunnel.url, close: () => tunnel.close() };
}

/**
 * Lets a voice worker discover its own public HTTPS base URL at boot by
 * opening a free cloudflared "quick tunnel", instead of requiring
 * VOICE_PUBLIC_BASE_URL to be configured ahead of time. Deliberately
 * temporary/ephemeral infrastructure - a `*.trycloudflare.com` URL is torn
 * down and re-minted on every worker restart.
 *
 * Reuses the SDK's `openTwilioTunnel` (cloudflared provider) rather than
 * re-spawning cloudflared here - the same helper the JS a-leg e2e test uses to
 * open its own quick tunnel.
 *
 * NOTE the import shape. The SDK does NOT export this at its package root: its
 * root index does `export * as voice from "./voice"`, so the helper is reached
 * as `voice.openTwilioTunnel`, not as a flat named import. A flat import type
 * checks against the .d.ts but resolves to `undefined` at runtime, which fails
 * only when the real (non-injected) default is called - that is, at worker
 * boot in production, and never in a test that injects `openTunnel`. See the
 * "binds the real SDK helper" test, which exists to catch exactly that.
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

import { voice as scenarioVoice } from "@langwatch/scenario";

type OpenedTunnel = Awaited<
  ReturnType<typeof scenarioVoice.openTwilioTunnel>
>;

/**
 * The SDK helper this module falls back to when no opener is injected. Exported
 * only so a test can assert it is actually callable: every other test injects
 * `openTunnel`, so a broken import here would otherwise surface for the first
 * time at worker boot in production.
 */
export const defaultOpenTunnel = scenarioVoice.openTwilioTunnel;

/**
 * How long to wait for the fresh hostname to become globally resolvable.
 *
 * Matches the SDK's own equivalent gate. Propagation is usually seconds, but a
 * short cap turns a slow-but-working tunnel into a failed worker boot, and the
 * cost of waiting is paid once per worker rather than once per call.
 */
export const TUNNEL_READY_TIMEOUT_MS_DEFAULT = 300_000;
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

/**
 * Ask one DNS-over-HTTPS endpoint for `host`'s A record. Returns true only on a
 * NOERROR response that actually carries an answer.
 */
async function dohHasAnswer(endpoint: string, host: string): Promise<boolean> {
  const res = await fetch(
    `${endpoint}?name=${encodeURIComponent(host)}&type=A`,
    { headers: { accept: "application/dns-json" } },
  );
  if (!res.ok) return false;
  const data = (await res.json()) as {
    Status?: number;
    Answer?: Array<{ data?: string }>;
  };
  return data.Status === 0 && (data.Answer?.length ?? 0) > 0;
}

/**
 * True once the hostname is resolvable on the public internet.
 *
 * Asks two public DNS-over-HTTPS resolvers and returns the instant either
 * answers. What this gate has to predict is whether TWILIO can find the
 * tunnel, and Twilio resolves from its own network, so a public resolver is
 * the right oracle.
 *
 * The local system resolver is deliberately NOT consulted, for two reasons
 * found the hard way:
 *
 * 1. Asking it before the name exists caches the NXDOMAIN, with a negative TTL
 *    of half an hour on this zone. It then keeps denying a name that is live
 *    everywhere else, so including it makes readiness slower and flakier, not
 *    safer.
 * 2. Its answer does not generalise. On one host it returned only AAAA records
 *    for a live tunnel while every public resolver returned A records; with no
 *    IPv6 route, everything local failed with ENETUNREACH even though the
 *    tunnel was perfectly healthy and reachable from the outside.
 *
 * Also deliberately a DNS check rather than an HTTPS round-trip: this machine's
 * own egress to the Cloudflare edge can be broken while Twilio's path to the
 * same tunnel is clean, so a failed GET here would prove nothing.
 */
async function defaultResolveHost(host: string): Promise<boolean> {
  try {
    await Promise.any([
      dohHasAnswer("https://cloudflare-dns.com/dns-query", host).then((ok) => {
        if (!ok) throw new Error("no answer");
      }),
      dohHasAnswer("https://dns.google/resolve", host).then((ok) => {
        if (!ok) throw new Error("no answer");
      }),
    ]);
    return true;
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
  const openTunnel = params.openTunnel ?? defaultOpenTunnel;
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

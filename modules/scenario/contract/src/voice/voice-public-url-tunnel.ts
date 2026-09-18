// Discover worker's public HTTPS URL via cloudflared quick tunnel instead of pre-configuring.
// Ephemeral per restart; minted via SDK's openTwilioTunnel. Waits for DNS propagation before ready.

import { voice as scenarioVoice } from "@langwatch/scenario";
import { nowInstant } from "@langwatch/time";

import { ensureCloudflaredOnPath } from "./voice-cloudflared-binary.ts";

type OpenedTunnel = Awaited<ReturnType<typeof scenarioVoice.openTwilioTunnel>>;

/**
 * The SDK helper this module falls back to when no opener is injected.
 * Exported so a test can assert it's callable — every other test injects
 * `openTunnel`, so a broken import would otherwise surface first in production.
 */
export const defaultOpenTunnel: (
  // Written out rather than inferred: the SDK reaches this helper through a
  // namespace re-export, so its own option and result types have no importable
  // name and a declaration emit cannot write the inferred signature (TS4023).
  // Deriving both sides off the value keeps the signature exact.
  ...args: Parameters<typeof scenarioVoice.openTwilioTunnel>
) => ReturnType<typeof scenarioVoice.openTwilioTunnel> = scenarioVoice.openTwilioTunnel;

/**
 * How long to wait for the fresh hostname to become globally resolvable,
 * matching the SDK's own gate. Propagation is usually seconds, but a short
 * cap turns a slow-but-working tunnel into a failed worker boot.
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

// DNS-over-HTTPS probe timeout; prevents stalled resolver from parking boot forever.
const DOH_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Ask one DNS-over-HTTPS endpoint for `host`'s A record. Returns true only on a
 * NOERROR response that actually carries an answer.
 */
async function dohHasAnswer(endpoint: string, host: string): Promise<boolean> {
  const res = await fetch(`${endpoint}?name=${encodeURIComponent(host)}&type=A`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(DOH_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as {
    Status?: number;
    Answer?: { data?: string }[];
  };
  return data.Status === 0 && (data.Answer?.length ?? 0) > 0;
}

// Hostname resolvable on public internet. Asks two public DNS-over-HTTPS resolvers (not local).
// DNS check, not HTTPS, predicts Twilio's reach.
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
 * VoiceTunnelNotReadyError once `timeoutMs` elapses. Exported separately
 * from `openVoicePublicUrlTunnel` so the gate can be unit-tested standalone.
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
  const deadline = nowInstant().epochMilliseconds + timeoutMs;

  for (;;) {
    if (await resolveHost(host)) return;
    if (nowInstant().epochMilliseconds >= deadline) {
      throw new VoiceTunnelNotReadyError(
        `voice public URL tunnel ${params.url} did not become globally resolvable within ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * Open a cloudflared quick tunnel to `port`, waiting until globally
 * resolvable; throws (closing the tunnel) if not within `timeoutMs` — an
 * unresolvable tunnel otherwise fails silently in ~1s, costlier than failing fast.
 */
export async function openVoicePublicUrlTunnel(params: {
  port: number;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  pollIntervalMs?: number;
  openTunnel?: (opts: { port: number; provider: "cloudflared" }) => Promise<OpenedTunnel>;
  resolveHost?: (host: string) => Promise<boolean>;
  /** Puts the cloudflared binary on PATH before `openTunnel` spawns it.
   *  Injectable so a test with a fake opener stays hermetic; defaults to the
   *  real {@link ensureCloudflaredOnPath}. */
  ensureBinaryOnPath?: () => Promise<void>;
}): Promise<VoicePublicUrlTunnel> {
  const openTunnel = params.openTunnel ?? defaultOpenTunnel;
  // The SDK's cloudflared provider opens the tunnel with a bare
  // `spawn("cloudflared", ...)`, a PATH lookup, so the binary's directory
  // must be on PATH before openTunnel runs (see voice-cloudflared-binary.ts).
  const ensureBinaryOnPath =
    params.ensureBinaryOnPath ?? (() => ensureCloudflaredOnPath({ env: params.env }));
  await ensureBinaryOnPath();
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
    // Best-effort teardown. An unguarded rejection here would escape in place
    // of the readiness error, which is the one naming the URL and the timeout.
    await tunnel.close().catch(() => undefined);
    throw error;
  }
  return { url: tunnel.url, close: () => tunnel.close() };
}

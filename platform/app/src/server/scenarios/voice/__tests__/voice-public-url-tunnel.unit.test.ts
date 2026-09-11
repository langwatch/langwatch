/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it, vi } from "vitest";
import {
  openVoicePublicUrlTunnel,
  tunnelHostFromUrl,
  VoiceTunnelNotReadyError,
  waitUntilTunnelResolvable,
} from "../voice-public-url-tunnel";

const FAST = { timeoutMs: 30, pollIntervalMs: 5 };

describe("tunnelHostFromUrl", () => {
  /** @scenario "A voice worker opens a quick tunnel when no public base URL is configured" */
  it("extracts the bare host from a cloudflared quick-tunnel URL", () => {
    expect(tunnelHostFromUrl("https://random-words.trycloudflare.com")).toBe(
      "random-words.trycloudflare.com",
    );
  });

  /** @scenario "A voice worker opens a quick tunnel when no public base URL is configured" */
  it("strips a path or trailing slash", () => {
    expect(
      tunnelHostFromUrl("https://random-words.trycloudflare.com/twilio/abc"),
    ).toBe("random-words.trycloudflare.com");
    expect(tunnelHostFromUrl("http://plain-host/")).toBe("plain-host");
  });
});

describe("waitUntilTunnelResolvable", () => {
  /** @scenario "A voice worker opens a quick tunnel when no public base URL is configured" */
  it("resolves once the injected resolver reports the host resolvable", async () => {
    const resolveHost = vi
      .fn<(host: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await waitUntilTunnelResolvable({
      url: "https://fresh.trycloudflare.com",
      resolveHost,
      ...FAST,
    });

    expect(resolveHost).toHaveBeenCalledWith("fresh.trycloudflare.com");
    expect(resolveHost).toHaveBeenCalledTimes(3);
  });

  /** @scenario "A voice worker's public URL tunnel fails fast when it never becomes reachable" */
  it("throws VoiceTunnelNotReadyError once the timeout elapses without a resolution", async () => {
    const resolveHost = vi.fn<(host: string) => Promise<boolean>>().mockResolvedValue(false);

    await expect(
      waitUntilTunnelResolvable({
        url: "https://never-resolves.trycloudflare.com",
        resolveHost,
        ...FAST,
      }),
    ).rejects.toThrow(VoiceTunnelNotReadyError);
  });

  /** @scenario "A voice worker's public URL tunnel fails fast when it never becomes reachable" */
  it("names the tunnel URL and timeout in the failure message", async () => {
    const resolveHost = vi.fn<(host: string) => Promise<boolean>>().mockResolvedValue(false);

    await expect(
      waitUntilTunnelResolvable({
        url: "https://never-resolves.trycloudflare.com",
        resolveHost,
        ...FAST,
      }),
    ).rejects.toThrow(/never-resolves\.trycloudflare\.com.*30ms/s);
  });
});

describe("openVoicePublicUrlTunnel", () => {
  /** @scenario "A voice worker opens a quick tunnel when no public base URL is configured" */
  it("returns the opened tunnel's URL once it becomes resolvable", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const openTunnel = vi.fn().mockResolvedValue({
      url: "https://ready.trycloudflare.com",
      provider: "cloudflared" as const,
      close,
    });
    const resolveHost = vi.fn().mockResolvedValue(true);

    const tunnel = await openVoicePublicUrlTunnel({
      port: 3300,
      openTunnel,
      resolveHost,
      ...FAST,
    });

    expect(tunnel.url).toBe("https://ready.trycloudflare.com");
    expect(openTunnel).toHaveBeenCalledWith({
      port: 3300,
      provider: "cloudflared",
    });
    expect(close).not.toHaveBeenCalled();
  });

  /** @scenario "A voice worker's public URL tunnel fails fast when it never becomes reachable" */
  it("closes the tunnel and rethrows when readiness never arrives", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const openTunnel = vi.fn().mockResolvedValue({
      url: "https://dead.trycloudflare.com",
      provider: "cloudflared" as const,
      close,
    });
    const resolveHost = vi.fn().mockResolvedValue(false);

    await expect(
      openVoicePublicUrlTunnel({
        port: 3300,
        openTunnel,
        resolveHost,
        ...FAST,
      }),
    ).rejects.toThrow(VoiceTunnelNotReadyError);
    expect(close).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A voice worker's quick tunnel is closed on worker shutdown" */
  it("returns a close() that delegates to the underlying tunnel's close", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const openTunnel = vi.fn().mockResolvedValue({
      url: "https://ready.trycloudflare.com",
      provider: "cloudflared" as const,
      close,
    });
    const resolveHost = vi.fn().mockResolvedValue(true);

    const tunnel = await openVoicePublicUrlTunnel({
      port: 3300,
      openTunnel,
      resolveHost,
      ...FAST,
    });
    await tunnel.close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

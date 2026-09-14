/**
 * @vitest-environment node
 * @see specs/features/agents/voice-phone.feature
 *
 * Tests that voice boot failures (tunnel, listener) are non-fatal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/scenarios/voice/voice-public-url-tunnel", () => ({
  openVoicePublicUrlTunnel: vi.fn(async () => {
    throw new Error("cloudflared failed to start");
  }),
}));

vi.mock("~/server/workers/voice-ws-listener", () => ({
  bootVoiceWsListener: vi.fn(async () => {
    throw new Error("EADDRINUSE");
  }),
}));

vi.mock("~/server/scenarios/voice/voice-nonce-registry", () => ({
  getVoiceNonceRegistry: vi.fn(() => ({})),
}));

describe("voice boot non-fatal guards", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /** @scenario "A worker's own voice boot failure does not take the worker down" */
  it("bootVoicePublicUrlTunnel returns undefined instead of throwing when the tunnel fails to open", async () => {
    const { bootVoicePublicUrlTunnel } = await import("../startWorkers");

    const shutdownHandles: Array<() => Promise<void> | void> = [];
    const result = await bootVoicePublicUrlTunnel(shutdownHandles, {
      voiceWsPort: 3300,
      voicePublicBaseUrl: undefined,
      voiceTunnelEnabled: true,
    });

    expect(result).toBeUndefined();
    expect(shutdownHandles).toHaveLength(0);
  });

  /** @scenario "A worker's own voice boot failure does not take the worker down" */
  it("bootVoiceListener resolves instead of throwing when the listener fails to bind", async () => {
    const { bootVoiceListener } = await import("../startWorkers");

    const shutdownHandles: Array<() => Promise<void> | void> = [];
    await expect(
      bootVoiceListener(shutdownHandles, {
        voiceWsPort: 3300,
        voicePublicBaseUrl: undefined,
      }),
    ).resolves.toBeUndefined();
    expect(shutdownHandles).toHaveLength(0);
  });
});

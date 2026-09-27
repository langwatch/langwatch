import { describe, expect, it } from "vitest";

import { MemoryVoicePublicUrlTunnelChannel } from "../../channels/memory/memory.voice-public-url-tunnel.channel.ts";
import { VoicePublicUrlService } from "../voice-public-url.service.ts";

const PORT = 3300;

describe("VoicePublicUrlService", () => {
  describe("given a configured public origin", () => {
    it("answers it and opens no tunnel", async () => {
      const tunnel = MemoryVoicePublicUrlTunnelChannel.create({ url: "https://tunnel.test" });

      const resolved = await VoicePublicUrlService.create({ openTunnel: tunnel.open }).resolve({
        configuredUrl: "https://voice.example.com",
        tunnelEnabled: true,
        port: PORT,
        environment: {},
      });

      expect(resolved.publicUrl).toEqual({ url: "https://voice.example.com" });
      expect(tunnel.openedPorts).toEqual([]);
    });
  });

  describe("given no configured origin and the tunnel turned off", () => {
    it("answers unavailable with the reason", async () => {
      const resolved = await VoicePublicUrlService.create().resolve({
        configuredUrl: undefined,
        tunnelEnabled: false,
        port: PORT,
        environment: {},
      });

      expect(resolved.publicUrl).toEqual({
        unavailable: "VOICE_PUBLIC_BASE_URL is unset and VOICE_TUNNEL is off",
      });
    });
  });

  describe("given no configured origin and the tunnel on", () => {
    it("opens a tunnel to the media door's port and closes it on release", async () => {
      const tunnel = MemoryVoicePublicUrlTunnelChannel.create({ url: "https://tunnel.test" });

      const resolved = await VoicePublicUrlService.create({ openTunnel: tunnel.open }).resolve({
        configuredUrl: undefined,
        tunnelEnabled: true,
        port: PORT,
        environment: {},
      });
      await resolved.close();

      expect(resolved.publicUrl).toEqual({ url: "https://tunnel.test" });
      expect(tunnel.openedPorts).toEqual([PORT]);
      expect(tunnel.closed).toBe(1);
    });

    it("stays up without an origin when the tunnel fails, naming why", async () => {
      const tunnel = MemoryVoicePublicUrlTunnelChannel.create({
        failure: "spawn cloudflared ENOENT",
      });

      const resolved = await VoicePublicUrlService.create({ openTunnel: tunnel.open }).resolve({
        configuredUrl: undefined,
        tunnelEnabled: true,
        port: PORT,
        environment: {},
      });

      expect(resolved.publicUrl).toEqual({ unavailable: "spawn cloudflared ENOENT" });
    });
  });
});

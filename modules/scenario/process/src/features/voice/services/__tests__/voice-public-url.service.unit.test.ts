import { describe, expect, it } from "vitest";

import { MemoryVoicePublicUrlTunnelChannel } from "../../../../channels/memory/memory.voice-public-url-tunnel.channel.ts";
import { VoicePublicUrlService } from "../voice-public-url.service.ts";

const PORT = 3300;

describe("VoicePublicUrlService", () => {
  describe("given a configured public origin", () => {
    /** @scenario "An explicit public base URL always wins over the tunnel fallback" */
    it("answers it and opens no tunnel", async () => {
      const tunnel = MemoryVoicePublicUrlTunnelChannel.create({ url: "https://tunnel.test" });

      const resolved = await VoicePublicUrlService.create({ openTunnel: tunnel.open }).resolve({
        configuredUrl: "https://voice.example.com",
        tunnelEnabled: true,
        port: PORT,
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
      });
      await resolved.close();

      expect(resolved.publicUrl).toEqual({ url: "https://tunnel.test" });
      expect(tunnel.openedPorts).toEqual([PORT]);
      expect(tunnel.closed).toBe(1);
    });

    /** @scenario "A failed voice tunnel boot records its reason for the phone run error" */
    /** @scenario "A worker's own voice boot failure does not take the worker down" */
    it("stays up without an origin when the tunnel fails, naming why", async () => {
      const tunnel = MemoryVoicePublicUrlTunnelChannel.create({
        failure: "spawn cloudflared ENOENT",
      });

      const resolved = await VoicePublicUrlService.create({ openTunnel: tunnel.open }).resolve({
        configuredUrl: undefined,
        tunnelEnabled: true,
        port: PORT,
      });

      expect(resolved.publicUrl).toEqual({ unavailable: "spawn cloudflared ENOENT" });
    });
  });

  describe("given the role a process boots in", () => {
    const base = { configuredUrl: undefined, tunnelEnabled: false, workerOnly: false, port: PORT };

    it("answers unavailable outside the worker and opens no tunnel", async () => {
      const tunnel = MemoryVoicePublicUrlTunnelChannel.create({ url: "https://tunnel.test" });

      const source = VoicePublicUrlService.create({ openTunnel: tunnel.open }).forRole({
        ...base,
        role: "api",
        tunnelEnabled: true,
      });

      await expect(source.acquire()).resolves.toEqual({
        unavailable: "this role runs no scenario children",
      });
      expect(tunnel.openedPorts).toEqual([]);
    });

    it("refuses a voice-only worker without a public base URL", () => {
      expect(() =>
        VoicePublicUrlService.create().forRole({ ...base, role: "worker", workerOnly: true }),
      ).toThrow(/VOICE_PUBLIC_BASE_URL is missing/);
    });

    /** @scenario "A public base URL must be an https origin" */
    it("starts a voice-only worker with a public https base URL and reports it", async () => {
      const source = VoicePublicUrlService.create().forRole({
        ...base,
        role: "worker",
        workerOnly: true,
        configuredUrl: "https://voice.example.com",
      });

      await expect(source.acquire()).resolves.toEqual({ url: "https://voice.example.com" });
    });

    /** @scenario "A public base URL must be an https origin" */
    it("rejects a non-https public base URL", () => {
      expect(() =>
        VoicePublicUrlService.create().forRole({
          ...base,
          role: "worker",
          configuredUrl: "http://voice.example.com",
        }),
      ).toThrow(/https origin/);
    });
  });

  describe("given a worker with the tunnel on and no configured origin", () => {
    const worker = {
      role: "worker" as const,
      configuredUrl: undefined,
      tunnelEnabled: true,
      workerOnly: false,
      port: PORT,
    };

    /** @scenario "A worker boots without waiting for the voice tunnel" */
    it("opens nothing at boot", () => {
      const tunnel = MemoryVoicePublicUrlTunnelChannel.create({ url: "https://tunnel.test" });

      VoicePublicUrlService.create({ openTunnel: tunnel.open }).forRole(worker);

      expect(tunnel.openedPorts).toEqual([]);
    });

    /** @scenario "The first voice run opens the tunnel once for every concurrent caller" */
    it("opens one tunnel for concurrent first callers and reuses it after", async () => {
      const tunnel = MemoryVoicePublicUrlTunnelChannel.create({ url: "https://tunnel.test" });
      const source = VoicePublicUrlService.create({ openTunnel: tunnel.open }).forRole(worker);

      const answers = await Promise.all([source.acquire(), source.acquire()]);
      const later = await source.acquire();
      await source.close();

      expect(answers).toEqual([{ url: "https://tunnel.test" }, { url: "https://tunnel.test" }]);
      expect(later).toEqual({ url: "https://tunnel.test" });
      expect(tunnel.openedPorts).toEqual([PORT]);
      expect(tunnel.closed).toBe(1);
    });

    /** @scenario "A voice tunnel that fails on first use names its reason to the phone run" */
    it("answers the tunnel's failure reason and does not retry it", async () => {
      const tunnel = MemoryVoicePublicUrlTunnelChannel.create({
        failure: "spawn cloudflared ENOENT",
      });
      const source = VoicePublicUrlService.create({ openTunnel: tunnel.open }).forRole(worker);

      const first = await source.acquire();
      const second = await source.acquire();

      expect(first).toEqual({ unavailable: "spawn cloudflared ENOENT" });
      expect(second).toEqual(first);
      expect(tunnel.openedPorts).toEqual([PORT]);
    });

    it("closes without opening when no voice run ever asked", async () => {
      const tunnel = MemoryVoicePublicUrlTunnelChannel.create({ url: "https://tunnel.test" });
      const source = VoicePublicUrlService.create({ openTunnel: tunnel.open }).forRole(worker);

      await source.close();

      await expect(source.acquire()).resolves.toEqual({
        unavailable: "the worker is shutting down",
      });
      expect(tunnel.openedPorts).toEqual([]);
    });
  });
});

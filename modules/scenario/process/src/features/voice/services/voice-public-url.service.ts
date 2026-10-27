import { createLogger } from "@langwatch/observability";
import type { ServerRole } from "@langwatch/process";

import {
  openVoicePublicUrlTunnel,
  type VoicePublicUrlTunnel,
} from "../../../channels/voice-public-url-tunnel.channels.ts";

const logger = createLogger("langwatch:voice:public-url");

/** The worker's public media origin, or why it has none (record §8). */
export type VoicePublicUrl = { url: string } | { unavailable: string };

/** What the worker resolved, and how to release the tunnel it may have opened. */
type ResolvedVoicePublicUrl = Readonly<{
  publicUrl: VoicePublicUrl;
  close: () => Promise<void>;
}>;

/** The worker's public media origin, acquired on the first voice run and shared after. */
export type VoicePublicUrlSource = Readonly<{
  acquire: () => Promise<VoicePublicUrl>;
  close: () => Promise<void>;
}>;

/**
 * A configured origin wins; else, unless turned off, a quick tunnel to the media door's
 * port, opened on the first voice run rather than at boot. A tunnel that fails is
 * non-fatal and its reason is what the phone run names.
 */
export class VoicePublicUrlService {
  static create(
    input: {
      openTunnel?: (input: { port: number }) => Promise<VoicePublicUrlTunnel>;
    } = {},
  ): VoicePublicUrlService {
    return new VoicePublicUrlService(input.openTunnel);
  }

  private constructor(
    private readonly openTunnel:
      | ((input: { port: number }) => Promise<VoicePublicUrlTunnel>)
      | undefined,
  ) {}

  /**
   * Only the worker, which spawns the children, acquires an address; a voice-only worker
   * refuses to boot without a public https origin, as main's did. Nothing opens here.
   */
  forRole(input: {
    role: ServerRole | undefined;
    configuredUrl: string | undefined;
    tunnelEnabled: boolean;
    workerOnly: boolean;
    port: number;
  }): VoicePublicUrlSource {
    if (input.role !== "worker") {
      return VoicePublicUrlService.fixed({ unavailable: "this role runs no scenario children" });
    }
    if (input.configuredUrl !== undefined && !input.configuredUrl.startsWith("https://")) {
      throw new Error("VOICE_PUBLIC_BASE_URL must be an https origin");
    }
    if (input.workerOnly && input.configuredUrl === undefined) {
      throw new Error(
        "VOICE_WORKER_ONLY is set but VOICE_PUBLIC_BASE_URL is missing; the voice worker refuses to start without a public https origin Twilio can dial back.",
      );
    }
    return this.lazily(input);
  }

  /** Concurrent first callers share one acquisition; its answer, failure included, is kept. */
  lazily(input: {
    configuredUrl: string | undefined;
    tunnelEnabled: boolean;
    port: number;
  }): VoicePublicUrlSource {
    let pending: Promise<ResolvedVoicePublicUrl> | undefined;
    let closed = false;
    return {
      acquire: async () => {
        if (closed) return { unavailable: "the worker is shutting down" };
        pending ??= this.resolve(input);
        return (await pending).publicUrl;
      },
      close: async () => {
        closed = true;
        if (pending) await (await pending).close();
      },
    };
  }

  private static fixed(publicUrl: VoicePublicUrl): VoicePublicUrlSource {
    return { acquire: async () => publicUrl, close: async () => {} };
  }

  async resolve(input: {
    configuredUrl: string | undefined;
    tunnelEnabled: boolean;
    port: number;
  }): Promise<ResolvedVoicePublicUrl> {
    const released = async (): Promise<void> => {};
    if (input.configuredUrl !== undefined) {
      return { publicUrl: { url: input.configuredUrl }, close: released };
    }
    if (!input.tunnelEnabled) {
      return {
        publicUrl: { unavailable: "VOICE_PUBLIC_BASE_URL is unset and VOICE_TUNNEL is off" },
        close: released,
      };
    }
    try {
      const tunnel = await (this.openTunnel
        ? this.openTunnel({ port: input.port })
        : openVoicePublicUrlTunnel({ port: input.port }));
      logger.info({ url: tunnel.url }, "voice public URL tunnel ready");
      return { publicUrl: { url: tunnel.url }, close: () => tunnel.close() };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error({ error }, "voice public URL tunnel failed to open; phone runs will fail");
      return { publicUrl: { unavailable: reason }, close: released };
    }
  }
}

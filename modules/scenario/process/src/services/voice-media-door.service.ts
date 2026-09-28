import { Socket } from "node:net";

import { createLogger } from "@langwatch/observability";
import {
  VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE,
  type VoiceMediaUpgrade,
  type VoiceMediaUpgradeRefusedMessage,
} from "@langwatch/scenario-contract";

import { handOffVoiceSocket } from "../channels/voice-socket-handoff.channels.ts";
import type { VoiceNonceRegistryService } from "./voice-nonce-registry.service.ts";

const logger = createLogger("langwatch:voice:media-door");

/**
 * Main's voice media listener, behind the worker's raw-socket door: an unknown or
 * expired nonce is closed 403 (an expired one tells its child why), a live one hands
 * the raw socket to the scenario child that registered it.
 */
export class VoiceMediaDoorService {
  static create(input: { nonces: VoiceNonceRegistryService }): VoiceMediaDoorService {
    return new VoiceMediaDoorService(input.nonces);
  }

  private constructor(private readonly nonces: VoiceNonceRegistryService) {}

  accept(upgrade: VoiceMediaUpgrade): void {
    const { socket } = upgrade;
    if (!(socket instanceof Socket)) {
      logger.error({ url: upgrade.url }, "voice media upgrade arrived without a TCP socket");
      return;
    }
    const lookup = this.nonces.consume(upgrade.nonce);
    if (!lookup.ok) {
      const reason = `nonce ${lookup.reason}`;
      logger.warn({ url: upgrade.url, status: 403, reason }, "voice media upgrade refused");
      if (lookup.reason === "expired" && lookup.child.send) {
        const notice: VoiceMediaUpgradeRefusedMessage = {
          type: VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE,
          reason,
        };
        lookup.child.send(notice);
      }
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    void handOffVoiceSocket({
      child: lookup.child,
      socket,
      nonce: upgrade.nonce,
      url: upgrade.url,
      method: upgrade.method,
      headers: { ...upgrade.headers },
      head: Buffer.from(upgrade.head),
    })
      .then(() => logger.info({ nonce: upgrade.nonce }, "voice media socket handed to child"))
      .catch((error: unknown) => {
        logger.error({ error, nonce: upgrade.nonce }, "voice media socket handoff failed");
        socket.destroy();
      });
  }
}

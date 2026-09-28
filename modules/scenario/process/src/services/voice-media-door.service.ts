import type { ChildProcess } from "node:child_process";
import { Socket } from "node:net";

import { createLogger } from "@langwatch/observability";
import {
  VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE,
  type VoiceMediaUpgrade,
  type VoiceMediaUpgradeRefusedMessage,
} from "@langwatch/scenario-contract";

import { handOffVoiceSocket } from "../channels/voice-socket-handoff.channels.ts";
import {
  isTwilioMediaSignatureValid,
  twilioMediaStreamUrl,
} from "../rules/twilio-media-signature.rules.ts";
import type { VoiceNonceRegistryService } from "./voice-nonce-registry.service.ts";
import type { VoicePublicUrl } from "./voice-public-url.service.ts";

const logger = createLogger("langwatch:voice:media-door");

/**
 * Main's voice media listener, behind the worker's raw-socket door: an unknown or expired
 * nonce, or an upgrade Twilio did not sign for the stream URL, is closed 403 (a known child is
 * told why); a live, signed one hands the raw socket to the scenario child that registered it.
 */
export class VoiceMediaDoorService {
  static create(input: {
    nonces: VoiceNonceRegistryService;
    publicUrl: VoicePublicUrl;
  }): VoiceMediaDoorService {
    return new VoiceMediaDoorService(input.nonces, input.publicUrl);
  }

  private constructor(
    private readonly nonces: VoiceNonceRegistryService,
    private readonly publicUrl: VoicePublicUrl,
  ) {}

  accept(upgrade: VoiceMediaUpgrade): void {
    const { socket } = upgrade;
    if (!(socket instanceof Socket)) {
      logger.error({ url: upgrade.url }, "voice media upgrade arrived without a TCP socket");
      return;
    }
    this.admit({ upgrade, socket }).catch((error: unknown) => {
      logger.error({ error, nonce: upgrade.nonce }, "voice media upgrade could not be admitted");
      socket.destroy();
    });
  }

  private async admit({
    upgrade,
    socket,
  }: {
    upgrade: VoiceMediaUpgrade;
    socket: Socket;
  }): Promise<void> {
    const lookup = await this.nonces.consume(upgrade.nonce);
    if (!lookup.ok) {
      const child = lookup.reason === "expired" ? lookup.child : undefined;
      refuse({ upgrade, socket, reason: `nonce ${lookup.reason}`, child });
      return;
    }
    if (!("url" in this.publicUrl)) {
      refuse({ upgrade, socket, reason: "no public media URL", child: lookup.child });
      return;
    }
    const streamUrl = twilioMediaStreamUrl({
      publicBaseUrl: this.publicUrl.url,
      nonce: upgrade.nonce,
    });
    const signature = upgrade.headers["x-twilio-signature"];
    if (!isTwilioMediaSignatureValid({ authToken: lookup.authToken, streamUrl, signature })) {
      refuse({ upgrade, socket, reason: "Twilio signature invalid", child: lookup.child });
      return;
    }
    await handOffVoiceSocket({
      child: lookup.child,
      socket,
      nonce: upgrade.nonce,
      url: upgrade.url,
      method: upgrade.method,
      headers: { ...upgrade.headers },
      head: Buffer.from(upgrade.head),
    });
    logger.info({ nonce: upgrade.nonce }, "voice media socket handed to child");
  }
}

/** Closes the upgrade 403 and, when a child owns the call, tells it why so it fails fast. */
function refuse(input: {
  upgrade: VoiceMediaUpgrade;
  socket: Socket;
  reason: string;
  child: ChildProcess | undefined;
}): void {
  logger.warn(
    { url: input.upgrade.url, status: 403, reason: input.reason },
    "voice media upgrade refused",
  );
  if (input.child?.send) {
    const notice: VoiceMediaUpgradeRefusedMessage = {
      type: VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE,
      reason: input.reason,
    };
    input.child.send(notice);
  }
  input.socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
}

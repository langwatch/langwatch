import type { ConnectUpstream } from "@langwatch/enterprise-licensing-contract";
import type { VoiceMediaUpgrade } from "@langwatch/scenario-contract";

/**
 * The install's license credential and the LangWatch gateway it presents it to: licensing's
 * `findConnectUpstream` entry, so a relay needs no secret of its own (tasks#1002 slice 4c).
 */
export type VoiceMediaRelayCredential = Pick<ConnectUpstream, "baseUrl" | "token" | "instanceId">;

/** One WebSocket frame, as either side sent it. */
export type VoiceMediaRelayFrame = { data: Buffer; isBinary: boolean };

/** How a relay ended: the close code and reason the gateway or this end gave. */
export type VoiceMediaRelayEnd = { code: number; reason: string };

/** A relay socket open on the gateway and waiting for, or joined to, Twilio's media stream. */
export interface VoiceMediaRelay {
  /** The wss URL Twilio streams the call's media to, and the URL Twilio signs. */
  readonly streamUrl: string;
  /** A prefix of the relay id, safe to log; the full id is a credential. */
  readonly logId: string;
  /** Settles when Twilio joins, with the X-Twilio-Signature it sent, or when the relay ends. */
  readonly joined: Promise<
    | { joined: true; twilioSignature: string | undefined }
    | { joined: false; end: VoiceMediaRelayEnd }
  >;
  /** Receives Twilio's frames after the join, in order; frames that came earlier are replayed. */
  onFrame(handler: (frame: VoiceMediaRelayFrame) => void): void;
  /** Sends one frame to Twilio. */
  send(frame: VoiceMediaRelayFrame): void;
  /** Called once when the relay ends; called at once if it already has. */
  onEnd(handler: (end: VoiceMediaRelayEnd) => void): void;
  /** Ends the relay. */
  close(end: VoiceMediaRelayEnd): void;
}

/** Why the gateway would not open a relay; `code` is the gateway's error code when it sent one. */
export type VoiceMediaRelayRefusal = { status: number; code?: string };

export type VoiceMediaRelayOpenResult =
  | { opened: true; relay: VoiceMediaRelay }
  | { opened: false; refusal: VoiceMediaRelayRefusal };

/**
 * The LangWatch gateway's Twilio media relay, for an install Twilio cannot reach: the worker dials
 * out, and Twilio dials the gateway (specs/ai-gateway/voice-media-relay.feature).
 */
export interface VoiceMediaRelayChannel {
  /** Opens a relay with the install's license token and waits for its ready frame. */
  open(input: { credential: VoiceMediaRelayCredential }): Promise<VoiceMediaRelayOpenResult>;
}

/** The raw upgrade a bridge makes for a joined relay; the caller names the nonce it carries. */
export type RelayedUpgrade = Omit<VoiceMediaUpgrade, "nonce">;

/**
 * Turns a joined relay into a raw upgrade on this worker, so the claim takes a relayed call as it
 * takes one Twilio dialled to the door; the relay's frames then cross to whoever holds the upgrade.
 */
export interface VoiceMediaRelayBridgeChannel {
  /** Resolves once the upgrade is under way; `onUpgrade` receives it, once, on `path`. */
  bridge(input: {
    relay: VoiceMediaRelay;
    path: string;
    twilioSignature: string | undefined;
    onUpgrade: (upgrade: RelayedUpgrade) => void;
  }): Promise<void>;
}

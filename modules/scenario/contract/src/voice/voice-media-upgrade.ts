/** A Twilio media upgrade on the worker door, handed unopened to the child that owns the call. */
export type VoiceMediaUpgrade = Readonly<{
  nonce: string;
  url: string;
  method: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  head: Uint8Array;
  /** The raw socket as the door accepted it; the process narrows it before handing it on. */
  socket: unknown;
}>;

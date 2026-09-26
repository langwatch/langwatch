/** A provider's call recording, relayed as it arrives so the credential stays server-side. */
export interface VoiceRecordingChannel {
  open(input: {
    url: string;
    headers: Record<string, string>;
    mediaType: string;
    signal?: AbortSignal;
  }): Promise<ReadableStream<Uint8Array>>;
}

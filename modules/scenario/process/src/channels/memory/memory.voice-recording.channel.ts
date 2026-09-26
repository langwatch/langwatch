import { VoiceRecordingUnavailableError } from "@langwatch/scenario-contract/voice-runtime";

import type { VoiceRecordingChannel } from "../voice-recording.channel.ts";

/** Serves fixed bytes per URL; an unknown URL reads as an unavailable recording. */
export class MemoryVoiceRecordingChannel implements VoiceRecordingChannel {
  static create(
    recordings: Record<string, Uint8Array> = {},
    twilioRecordingUrls: Record<string, string> = {},
  ): MemoryVoiceRecordingChannel {
    return new MemoryVoiceRecordingChannel(
      new Map(Object.entries(recordings)),
      new Map(Object.entries(twilioRecordingUrls)),
    );
  }

  readonly opened: { url: string; headers: Record<string, string> }[] = [];

  private constructor(
    private readonly recordings: Map<string, Uint8Array>,
    private readonly twilioRecordingUrls: Map<string, string>,
  ) {}

  async open(input: {
    url: string;
    headers: Record<string, string>;
    mediaType: string;
    signal?: AbortSignal;
  }): Promise<ReadableStream<Uint8Array>> {
    this.opened.push({ url: input.url, headers: input.headers });
    const bytes = this.recordings.get(input.url);
    if (!bytes) throw new VoiceRecordingUnavailableError();

    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  async getTwilioRecordingWavUrl(input: {
    credential: { accountSid: string; authToken: string };
    callSid: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const url = this.twilioRecordingUrls.get(input.callSid);
    if (!url) throw new VoiceRecordingUnavailableError();

    return url;
  }
}

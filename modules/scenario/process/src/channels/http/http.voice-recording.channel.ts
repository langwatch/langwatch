import {
  getTwilioRecordingWavUrl,
  proxyAudioStream,
  VoiceRecordingUnavailableError,
} from "@langwatch/scenario-contract/voice-runtime";

import type { VoiceRecordingChannel } from "../voice-recording.channel.ts";

export class HttpVoiceRecordingChannel implements VoiceRecordingChannel {
  static create(): HttpVoiceRecordingChannel {
    return new HttpVoiceRecordingChannel();
  }

  private constructor() {}

  async open(input: {
    url: string;
    headers: Record<string, string>;
    mediaType: string;
    signal?: AbortSignal;
  }): Promise<ReadableStream<Uint8Array>> {
    const response = await proxyAudioStream({
      signal: input.signal ?? new AbortController().signal,
      url: input.url,
      headers: input.headers,
      fallbackContentType: input.mediaType,
      forceContentType: input.mediaType,
    });
    if (!response.body) throw new VoiceRecordingUnavailableError();

    return response.body;
  }

  getTwilioRecordingWavUrl(input: {
    credential: { accountSid: string; authToken: string };
    callSid: string;
    signal?: AbortSignal;
  }): Promise<string> {
    return getTwilioRecordingWavUrl({
      credential: input.credential,
      callSid: input.callSid,
      signal: input.signal ?? new AbortController().signal,
    });
  }
}

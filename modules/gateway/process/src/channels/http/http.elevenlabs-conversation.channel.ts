import {
  createSsrfUrlValidator,
  type EgressTlsPolicy,
  type FencedFetchOptions,
  type SsrfUrlValidator,
  type SsrfValidationResult,
  fetchValidatedDestination,
} from "@langwatch/egress";

import {
  ELEVENLABS_PUBLIC_EGRESS,
  elevenLabsConversationReportSchema,
  type ElevenLabsConversationChannel,
  type ElevenLabsConversationRead,
} from "../elevenlabs-conversation.channel.ts";

/** What this channel reads of an answered fetch, and nothing else. */
export interface ConversationResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** The fenced fetch seam, injected so a test never opens a socket. */
export type FencedConversationFetch = (
  validated: SsrfValidationResult,
  init: FencedFetchOptions,
  tls: EgressTlsPolicy,
) => Promise<ConversationResponse>;

/**
 * The conversation read behind the egress fence. The request carries the
 * customer's `xi-api-key`, so a redirect is never followed: it would hand the
 * key to whatever host answered.
 */
export class HttpElevenLabsConversationChannel implements ElevenLabsConversationChannel {
  private constructor(
    private readonly validate: SsrfUrlValidator,
    private readonly fetchValidated: FencedConversationFetch,
    private readonly tls: EgressTlsPolicy,
  ) {}

  static create(
    options: { validate?: SsrfUrlValidator; fetchValidated?: FencedConversationFetch } = {},
  ): HttpElevenLabsConversationChannel {
    return new HttpElevenLabsConversationChannel(
      options.validate ??
        createSsrfUrlValidator({
          blockLocal: ELEVENLABS_PUBLIC_EGRESS.blockLocal,
          allowedHosts: [...ELEVENLABS_PUBLIC_EGRESS.allowedHosts],
        }),
      options.fetchValidated ?? fetchValidatedDestination,
      { rejectUnauthorized: ELEVENLABS_PUBLIC_EGRESS.verifyTls },
    );
  }

  /** A 404 is the vendor saying no call exists, which a minted-but-unused credential produces. */
  async readConversation(input: {
    apiKey: string;
    baseUrl: string;
    conversationId: string;
    timeoutMs: number;
  }): Promise<ElevenLabsConversationRead> {
    const url = `${input.baseUrl}/v1/convai/conversations/${encodeURIComponent(input.conversationId)}`;
    const validated = await this.validate(url);
    const response = await this.fetchValidated(
      validated,
      {
        method: "GET",
        headers: { "xi-api-key": input.apiKey },
        signal: AbortSignal.timeout(input.timeoutMs),
        followRedirects: false,
        headersTimeoutMs: input.timeoutMs,
        bodyTimeoutMs: input.timeoutMs,
      },
      this.tls,
    );
    if (response.status === 404) return { notFound: true };
    if (!response.ok) return { notFound: false };

    const parsed = elevenLabsConversationReportSchema.safeParse(await response.json());
    return parsed.success ? { report: parsed.data, notFound: false } : { notFound: false };
  }
}

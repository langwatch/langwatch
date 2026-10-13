// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export type GovernanceHttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  /**
   * Response headers, when the transport carries them. Optional because test doubles
   * build responses by hand; the 429 path doesn't use them, so absence = no Retry-After.
   */
  readonly headers?: Pick<Headers, "get">;
  /**
   * The response body stream, when the transport carries it. Optional for the same
   * reason as `headers`; callers only drain it, so absence means nothing to drain.
   */
  readonly body?: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export interface GovernanceHttpClient {
  fetch(
    url: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
      /** Forwarded to the SSRF-safe process adapter for secret-bearing calls. */
      followRedirects?: boolean;
    },
  ): Promise<GovernanceHttpResponse>;
}

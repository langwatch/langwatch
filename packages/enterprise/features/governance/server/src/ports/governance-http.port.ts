export type GovernanceHttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export abstract class GovernanceHttpPort {
  abstract fetch(
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

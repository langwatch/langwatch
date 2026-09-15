import {
  type AnomalyAlertHttpClient,
  type AnomalyAlertHttpResponse,
} from "@langwatch/enterprise-governance-server";

export type SsrfSafeFetch = (url: string, init: RequestInit) => Promise<Response>;

export class SsrfSafeAnomalyAlertHttpAdapter implements AnomalyAlertHttpClient {
  private constructor(private readonly fetch: SsrfSafeFetch) {}

  static create(fetch: SsrfSafeFetch): SsrfSafeAnomalyAlertHttpAdapter {
    return new SsrfSafeAnomalyAlertHttpAdapter(fetch);
  }

  async post(input: {
    url: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }): Promise<AnomalyAlertHttpResponse> {
    const response = await this.fetch(input.url, {
      method: "POST",
      headers: input.headers,
      body: input.body,
      signal: input.signal,
    });
    return {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
    };
  }
}

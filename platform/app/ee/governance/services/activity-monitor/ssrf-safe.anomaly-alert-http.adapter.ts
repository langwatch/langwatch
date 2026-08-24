import {
  AnomalyAlertHttpPort,
  type AnomalyAlertHttpResponse,
} from "@langwatch/enterprise-governance-server";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";

export class SsrfSafeAnomalyAlertHttpAdapter extends AnomalyAlertHttpPort {
  static create(): SsrfSafeAnomalyAlertHttpAdapter {
    return new SsrfSafeAnomalyAlertHttpAdapter();
  }

  async post(input: {
    url: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }): Promise<AnomalyAlertHttpResponse> {
    const response = await ssrfSafeFetch(input.url, {
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

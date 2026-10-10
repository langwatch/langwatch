// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AnomalyAlertHttpClient, AnomalyAlertHttpResponse } from "../anomaly-alert.channel.ts";
import { ssrfSafeFetch } from "./http.governance-http.channel.ts";

/** A rule's webhook destination is an admin-typed URL, so it is fenced as main's `ssrfSafeFetch` fenced it. */
export class HttpAnomalyAlertChannel implements AnomalyAlertHttpClient {
  private constructor() {}

  static create(): HttpAnomalyAlertChannel {
    return new HttpAnomalyAlertChannel();
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
    await response.body?.cancel().catch(() => undefined);
    return { ok: response.ok, status: response.status, statusText: response.statusText };
  }
}

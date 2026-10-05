// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export type AnomalyAlertHttpResponse = {
  status: number;
  ok: boolean;
  statusText: string;
};

export interface AnomalyAlertHttpClient {
  post(input: {
    url: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }): Promise<AnomalyAlertHttpResponse>;
}

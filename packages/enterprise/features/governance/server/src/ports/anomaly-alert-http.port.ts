export type AnomalyAlertHttpResponse = {
  status: number;
  ok: boolean;
  statusText: string;
};

export abstract class AnomalyAlertHttpPort {
  abstract post(input: {
    url: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }): Promise<AnomalyAlertHttpResponse>;
}

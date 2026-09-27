import { HubspotFormChannel, type HubspotFormReceipt } from "../hubspot-form.channel.ts";

const HUBSPOT_TIMEOUT_MS = 10_000;

export class HttpHubspotFormChannel extends HubspotFormChannel {
  private constructor(private readonly fetchFn: typeof fetch) {
    super();
  }

  static create(options: { fetchFn?: typeof fetch } = {}): HttpHubspotFormChannel {
    return new HttpHubspotFormChannel(options.fetchFn ?? fetch);
  }

  async submit({ url, body }: { url: string; body: object }): Promise<HubspotFormReceipt> {
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HUBSPOT_TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status };
  }
}

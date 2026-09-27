import { HubspotFormChannel, type HubspotFormReceipt } from "../hubspot-form.channel.ts";

/** Records what billing would have submitted to HubSpot, without a network call. */
export class MemoryHubspotFormChannel extends HubspotFormChannel {
  readonly submitted: { url: string; body: object }[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryHubspotFormChannel {
    return new MemoryHubspotFormChannel();
  }

  async submit(input: { url: string; body: object }): Promise<HubspotFormReceipt> {
    this.submitted.push(input);
    return { ok: true, status: 200 };
  }
}

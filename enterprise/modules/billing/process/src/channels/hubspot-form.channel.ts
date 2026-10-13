/** How HubSpot answered one form submission. */
export interface HubspotFormReceipt {
  readonly ok: boolean;
  readonly status: number;
}

/** Billing's HubSpot lead forms: one JSON submission per signal. */
export abstract class HubspotFormChannel {
  abstract submit(input: { url: string; body: object }): Promise<HubspotFormReceipt>;
}

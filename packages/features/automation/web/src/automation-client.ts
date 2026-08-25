import { triggerSchema, type Trigger } from "@langwatch/automation-contract";
export type AutomationClientOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};
/** Browser-safe compatibility client. The host supplies auth/cookies through
 * its fetch implementation; no server service or process singleton leaks into
 * the web package. */
export class AutomationClient {
  private readonly baseUrl: string;
  private readonly request: typeof globalThis.fetch;
  constructor(options: AutomationClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "/api";
    this.request = options.fetch ?? globalThis.fetch.bind(globalThis);
  }
  async list(projectId: string): Promise<Trigger[]> {
    const response = await this.request(
      `${this.baseUrl}/triggers?projectId=${encodeURIComponent(projectId)}`,
    );
    if (!response.ok) throw new Error(`Automation request failed (${response.status})`);
    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? body.map((row) => triggerSchema.parse(row)) : [];
  }
}

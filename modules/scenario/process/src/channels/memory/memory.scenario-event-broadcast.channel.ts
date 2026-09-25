import {
  ScenarioEventBroadcast,
  type ScenarioEventBroadcastMessage,
} from "../scenario-event-broadcast.channel.ts";

/** The tenant fan-out with no Redis behind it: every publish is kept, none is rate limited. */
export class MemoryScenarioEventBroadcastChannel extends ScenarioEventBroadcast {
  static create(): MemoryScenarioEventBroadcastChannel {
    return new MemoryScenarioEventBroadcastChannel();
  }

  readonly published: ScenarioEventBroadcastMessage[] = [];

  private constructor() {
    super();
  }

  async broadcastToTenant(input: ScenarioEventBroadcastMessage): Promise<void> {
    this.published.push(input);
  }

  async broadcastToTenantRateLimited({
    tier: _tier,
    ...published
  }: ScenarioEventBroadcastMessage & { tier: "structural" | "delta" }): Promise<boolean> {
    await this.broadcastToTenant(published);
    return true;
  }
}

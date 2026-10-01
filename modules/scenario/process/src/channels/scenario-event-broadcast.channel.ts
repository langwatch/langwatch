/** One `simulation_updated` message for a project's open tabs, as its publisher serialised it. */
export type ScenarioEventBroadcastMessage = Readonly<{
  projectId: string;
  message: string;
  eventType: "simulation_updated";
}>;

/** The simulation stream's published messages, expressed without a REST-host import. */
export abstract class ScenarioEventBroadcast {
  abstract broadcastToTenant(input: ScenarioEventBroadcastMessage): Promise<void>;

  /** Drops the message, answering false, once the project's allowance for its tier is spent. */
  abstract broadcastToTenantRateLimited(
    input: ScenarioEventBroadcastMessage & { tier: "structural" | "delta" },
  ): Promise<boolean>;
}

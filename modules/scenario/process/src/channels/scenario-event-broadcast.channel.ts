/** The simulation stream's published messages, expressed without a REST-host import. */
export abstract class ScenarioEventBroadcast {
  abstract broadcastToTenant(
    projectId: string,
    message: string,
    eventType: "simulation_updated",
  ): Promise<unknown>;

  abstract broadcastToTenantRateLimited(
    projectId: string,
    message: string,
    eventType: "simulation_updated",
    tier: "structural" | "delta",
  ): Promise<unknown>;
}

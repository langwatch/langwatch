import type { createLogger } from "@langwatch/observability";
import type { AggregateType } from "../domain/aggregateType";
import type { KillSwitchComponentType } from "./killSwitchKeys";

/** One component's stop question, asked for one tenant. */
export interface KillSwitchQuery {
  aggregateType: AggregateType | string;
  componentType: KillSwitchComponentType;
  componentName: string;
  /**
   * The tenant the work belongs to. An event-sourcing tenant id IS a project
   * id here, which is what makes the switch targetable at one tenant.
   */
  tenantId: string;
  customKey?: string;
}

/**
 * Whether a pipeline component is stopped for a tenant. An implementation
 * must be total: a lookup that fails answers "not killed", so a flag store
 * outage never stops the pipeline it exists to control.
 */
export abstract class KillSwitchPort {
  abstract isKilled(query: KillSwitchQuery): Promise<boolean>;
}

/**
 * The router's and the dispatcher's one way to ask. An unwired port answers
 * "running": a process that composed no flag store has no operator to obey.
 */
export async function isComponentKilled({
  killSwitch,
  logger,
  ...query
}: KillSwitchQuery & {
  killSwitch: KillSwitchPort | undefined;
  logger?: ReturnType<typeof createLogger>;
}): Promise<boolean> {
  if (!killSwitch) return false;

  const context = {
    componentName: query.componentName,
    componentType: query.componentType,
    tenantId: query.tenantId,
  };
  try {
    const killed = await killSwitch.isKilled(query);
    if (killed) logger?.debug(context, "Component stopped by its kill switch");
    return killed;
  } catch (error) {
    logger?.warn(
      { ...context, error },
      "Kill switch could not be read, leaving the component running",
    );
    return false;
  }
}

/**
 * Strips the provider secrets an alert's `actionParams` carries — the
 * encrypted Slack bot token (ADR-041), webhook header values (ADR-040 §3) —
 * per the trigger's own action, before the row leaves the server.
 *
 * The secrets belong to the automation provider that stored them, so the
 * process that composes those providers answers this.
 */
import type { Trigger } from "@langwatch/automation-contract";

export abstract class AlertRedactionPort {
  abstract redactActionParams(
    action: Trigger["action"],
    actionParams: Record<string, unknown>,
  ): Record<string, unknown>;
}

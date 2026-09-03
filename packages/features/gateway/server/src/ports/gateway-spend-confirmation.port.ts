import type { ConfirmSpendCommandData } from "../processes/gateway-spend-commands.process";

/**
 * Hands a confirmation to the gateway spend pipeline.
 *
 * The port exists so a voice settlement reaches the SAME pipeline the
 * gateway's own drainer sends to. A process that registered no such pipeline
 * refuses by name rather than dropping the confirmation, because a dropped
 * confirmation leaves an admitted spend record to settle as cost-unknown.
 */
export abstract class GatewaySpendConfirmationPort {
  abstract confirmSpend(data: ConfirmSpendCommandData): Promise<void>;
}

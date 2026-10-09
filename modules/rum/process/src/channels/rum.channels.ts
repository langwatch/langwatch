import type { RumCollectorChannel } from "./rum-collector.channel.ts";

/** Whether this deployment names a collector, and the channel to it when it does. */
type RumCollectorTarget =
  | Readonly<{ configured: true; channel: RumCollectorChannel }>
  | Readonly<{ configured: false }>;

/** Every channel rum holds, as the container hands them to the module class. */
export interface RumChannels {
  readonly collector: RumCollectorTarget;
}

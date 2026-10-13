import type { CustomerIoChannel } from "./customer-io.channel.ts";
import type { PostHogChannel } from "./posthog.channel.ts";

/** Every channel nurturing holds; a vendor with no key in this deployment is absent. */
export interface NurturingChannels {
  readonly customerIo: CustomerIoChannel | undefined;
  readonly posthog: PostHogChannel | undefined;
}

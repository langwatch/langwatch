import { NurturingApi } from "@langwatch/enterprise-nurturing-contract";
import type { BoundApis } from "@langwatch/process";

import {
  type CustomerIoMailChannel,
  NurturingCustomerIoMailChannel,
} from "./customer-io-mail.channel.ts";

/** Every channel notification holds, as the container hands them to the module class. */
export interface NotificationChannels {
  readonly customerIoMail: CustomerIoMailChannel;
}

/**
 * Both tiers bind nurturing for Cloud mail through Customer.io: a binding is no peer (record §5,
 * round 34), so it adds no peer-cycles edge though nurturing's peers depend on notification.
 */
export class BoundNotificationChannels {
  static readonly requires = [] as const;
  static readonly binds = { nurturing: NurturingApi } as const;

  static create({
    bound,
  }: {
    bound: BoundApis<typeof BoundNotificationChannels.binds>;
  }): NotificationChannels {
    return { customerIoMail: NurturingCustomerIoMailChannel.create(bound.nurturing) };
  }
}

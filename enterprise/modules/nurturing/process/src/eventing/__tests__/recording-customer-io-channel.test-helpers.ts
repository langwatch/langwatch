// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

import { CustomerIoChannel } from "../../channels/customer-io.channel.ts";

/**
 * A Customer.io channel that keeps every request it is asked for. The memory channel keeps
 * nothing, so it cannot show that a run stayed silent.
 */
export class RecordingCustomerIoChannel extends CustomerIoChannel {
  readonly requests: { method: string; input: unknown }[] = [];

  async identifyUser(input: Parameters<CustomerIoChannel["identifyUser"]>[0]): Promise<void> {
    this.requests.push({ method: "identifyUser", input });
  }

  async trackEvent(input: Parameters<CustomerIoChannel["trackEvent"]>[0]): Promise<void> {
    this.requests.push({ method: "trackEvent", input });
  }

  async groupUser(input: Parameters<CustomerIoChannel["groupUser"]>[0]): Promise<void> {
    this.requests.push({ method: "groupUser", input });
  }

  async batch(calls: CioBatchCall[]): Promise<void> {
    this.requests.push({ method: "batch", input: calls });
  }
}

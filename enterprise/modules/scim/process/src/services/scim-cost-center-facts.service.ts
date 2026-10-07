// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { EventingCommandSender } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { RecordCostCenterChangedCommandData } from "../eventing/scim-cost-center.events.ts";

/** scim_cost_center's senders, bound once the pipeline registers in this process. */
export type ScimCostCenterSenders = Readonly<{
  recordCostCenterChanged: Pick<EventingCommandSender<RecordCostCenterChangedCommandData>, "send">;
}>;

/** Records SCIM's cost-center facts on its own pipeline; governance assigns from its side. */
export class ScimCostCenterFactsService {
  #senders: ScimCostCenterSenders | undefined;

  static create(): ScimCostCenterFactsService {
    return new ScimCostCenterFactsService();
  }

  private constructor() {}

  connect(senders: ScimCostCenterSenders): void {
    this.#senders = senders;
  }

  /** Throws when scim_cost_center is not registered here or the record fails. */
  async recordCostCenterChanged(input: {
    organizationId: string;
    userId: string;
    costCenter: string | null;
  }): Promise<void> {
    const senders = this.#senders;
    if (!senders) throw new Error("scim_cost_center is not registered in this process");
    await senders.recordCostCenterChanged.send({
      tenantId: input.organizationId,
      organizationId: input.organizationId,
      userId: input.userId,
      costCenter: input.costCenter,
      occurredAt: nowInstant().epochMilliseconds,
    });
  }
}

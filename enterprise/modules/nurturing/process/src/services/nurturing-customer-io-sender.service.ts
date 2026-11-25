// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { createLogger } from "@langwatch/observability";

import type { NurturingService } from "./nurturing.service.ts";

const nurturingLogger = createLogger("langwatch:nurturing");

/** Runs a rule's decision against the configured Customer.io sink, one call at a time. */
export class NurturingCustomerIoSenderService {
  static create(customerIo: NurturingService): NurturingCustomerIoSenderService {
    return new NurturingCustomerIoSenderService(customerIo);
  }

  /**
   * Where a fire-and-forget lifecycle signal's failure goes. Warn rather than error, and
   * swallowed rather than rethrown: the caller has already done the thing the customer asked
   * for, and a Customer.io outage is not the customer's problem.
   */
  static readonly reportFailure = (error: unknown): void => {
    nurturingLogger.warn({ error }, "a lifecycle signal could not be delivered");
  };

  private constructor(private readonly customerIo: NurturingService) {}

  send(calls: CioBatchCall[]): void {
    for (const call of calls) {
      switch (call.type) {
        case "identify":
          void this.customerIo
            .identifyUser({ userId: call.userId, traits: call.traits })
            .catch(NurturingCustomerIoSenderService.reportFailure);
          break;
        case "track":
          void this.customerIo
            .trackEvent(call)
            .catch(NurturingCustomerIoSenderService.reportFailure);
          break;
        case "group":
          void this.customerIo
            .groupUser({ userId: call.userId, groupId: call.groupId, traits: call.traits })
            .catch(NurturingCustomerIoSenderService.reportFailure);
          break;
      }
    }
  }
}

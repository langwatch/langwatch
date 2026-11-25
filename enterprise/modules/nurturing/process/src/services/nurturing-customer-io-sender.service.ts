// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

import { NurturingFailureReportService } from "./nurturing-failure-report.service.ts";
import type { NurturingService } from "./nurturing.service.ts";

const { reportFailure } = NurturingFailureReportService;

/** Runs a rule's decision against the configured Customer.io sink, one call at a time. */
export class NurturingCustomerIoSenderService {
  static create(customerIo: NurturingService): NurturingCustomerIoSenderService {
    return new NurturingCustomerIoSenderService(customerIo);
  }

  private constructor(private readonly customerIo: NurturingService) {}

  send(calls: CioBatchCall[]): void {
    for (const call of calls) {
      switch (call.type) {
        case "identify":
          void this.customerIo
            .identifyUser({ userId: call.userId, traits: call.traits })
            .catch(reportFailure);
          break;
        case "track":
          void this.customerIo.trackEvent(call).catch(reportFailure);
          break;
        case "group":
          void this.customerIo
            .groupUser({ userId: call.userId, groupId: call.groupId, traits: call.traits })
            .catch(reportFailure);
          break;
      }
    }
  }
}

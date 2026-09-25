// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceClickHouseRepositories } from "../governance.repositories.ts";
import { MemoryAnomalySpendRepository } from "./memory.anomaly-spend.repository.ts";
import { MemoryOcsfEventsRepository } from "./memory.ocsf-events.repository.ts";
import { MemoryPersonalUsageRepository } from "./memory.personal-usage.repository.ts";
import { MemoryTraceActivityRepository } from "./memory.trace-activity.repository.ts";

/** Memory tier for the ClickHouse-backed governance repositories. No process
 *  members required — every twin below carries its own in-memory state. */
export class MemoryGovernanceClickHouseRepositories {
  static readonly requires = [] as const;

  static create(): GovernanceClickHouseRepositories {
    return {
      anomalySpend: MemoryAnomalySpendRepository.create(),
      ocsfEvents: MemoryOcsfEventsRepository.create(),
      traceActivity: MemoryTraceActivityRepository.create(),
      personalUsage: MemoryPersonalUsageRepository.create(),
    };
  }
}

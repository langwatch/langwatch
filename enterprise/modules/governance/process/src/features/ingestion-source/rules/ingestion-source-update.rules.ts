import type { UpdateGovernanceIngestionSourceCommand } from "@langwatch/enterprise-governance-contract";

import type { UpdateIngestionSourceRecord } from "../../../repositories/ingestion-source.repository.ts";

/** The fields of an update whose only rule is that they were supplied. */
export function plainUpdateFields(
  input: UpdateGovernanceIngestionSourceCommand,
): UpdateIngestionSourceRecord {
  const update: UpdateIngestionSourceRecord = {};
  if (input.name !== undefined) {
    update.name = input.name;
  }

  if (input.description !== undefined) {
    update.description = input.description;
  }

  if (input.status !== undefined) {
    update.status = input.status;
  }

  if (input.teamId !== undefined) {
    update.teamId = input.teamId;
  }

  if (input.pullSchedule !== undefined) {
    update.pullSchedule = input.pullSchedule;
  }

  return update;
}

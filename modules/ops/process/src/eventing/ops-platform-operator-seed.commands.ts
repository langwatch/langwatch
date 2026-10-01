import { defineCommand } from "@langwatch/eventing";

import {
  PLATFORM_OPERATOR_SEED_AGGREGATE_TYPE,
  PLATFORM_OPERATOR_SEED_RECORDED_EVENT_TYPE,
  PLATFORM_OPERATOR_SEED_RECORDED_EVENT_VERSION,
  platformOperatorSeedRecordedEventDataSchema,
} from "./ops-platform-operator-seed.events.ts";
import { PLATFORM_OPERATOR_SEED_PROCESS_NAME } from "./ops-platform-operator-seed.process.ts";

/**
 * Records the seed's one decision. Aggregate id is the process name and the tenant the
 * scheduled singleton's, so the event lands on the instance whose wake asked; one fixed key,
 * so it lands once.
 */
export const RecordPlatformOperatorSeedCommand = defineCommand({
  commandType: "lw.ops.platform_operator_seed.record",
  eventType: PLATFORM_OPERATOR_SEED_RECORDED_EVENT_TYPE,
  eventVersion: PLATFORM_OPERATOR_SEED_RECORDED_EVENT_VERSION,
  aggregateType: PLATFORM_OPERATOR_SEED_AGGREGATE_TYPE,
  schema: platformOperatorSeedRecordedEventDataSchema,
  aggregateId: () => PLATFORM_OPERATOR_SEED_PROCESS_NAME,
  idempotencyKey: () => "platform_operator_seed:recorded",
  makeJobId: () => "platform_operator_seed:recorded",
});

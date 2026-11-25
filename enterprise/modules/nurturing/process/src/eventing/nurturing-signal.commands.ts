// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  NURTURING_SIGNAL_AGGREGATE_TYPE,
  NURTURING_SIGNAL_RECORDED_EVENT_TYPE,
  NURTURING_SIGNAL_RECORDED_EVENT_VERSION,
  type NurturingSignalRecordedEvent,
  RECORD_NURTURING_SIGNAL_COMMAND_TYPE,
  type RecordNurturingSignalCommandData,
  recordNurturingSignalCommandDataSchema,
} from "./nurturing-signal.events.ts";

/** A signal's identity: its kind and the owner's event it came from. */
export function nurturingSignalKey(signal: NurturingSignal): string {
  return `${signal.kind}:${signal.sourceEventId}`;
}

/** Records one owner's signal; a redelivered one records the same event again, keyed alike. */
export class RecordNurturingSignalCommand implements CommandHandler<
  Command<RecordNurturingSignalCommandData>,
  NurturingSignalRecordedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_NURTURING_SIGNAL_COMMAND_TYPE,
    recordNurturingSignalCommandDataSchema,
    "Record a lifecycle or product-milestone signal an owner raised",
  );

  handle(command: Command<RecordNurturingSignalCommandData>): NurturingSignalRecordedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<NurturingSignalRecordedEvent>({
        aggregateType: NURTURING_SIGNAL_AGGREGATE_TYPE,
        aggregateId: nurturingSignalKey(data.signal),
        tenantId: createTenantId(command.tenantId),
        type: NURTURING_SIGNAL_RECORDED_EVENT_TYPE,
        version: NURTURING_SIGNAL_RECORDED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: nurturingSignalKey(data.signal),
      }),
    ];
  }

  static getAggregateId(payload: RecordNurturingSignalCommandData): string {
    return nurturingSignalKey(payload.signal);
  }
}

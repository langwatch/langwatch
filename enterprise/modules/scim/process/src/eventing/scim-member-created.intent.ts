// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a member-created intent does once the outbox delivers it: it sends SCIM's own command, so
 * the fact lands as `lw.scim.member_created` for organization's seat count (ADR-002).
 */
import type { EventingCommandSender, IntentExecutor, ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import { SCIM_MEMBERSHIP_PROCESS_NAME } from "../rules/scim-member-created.rules.ts";
import type { RecordMemberCreatedCommandData } from "./scim-member-created.events.ts";
import { SCIM_MEMBERSHIP_RETENTION_MS } from "./scim-member-created.process.ts";

export type ScimMemberCreatedSender = Pick<
  EventingCommandSender<RecordMemberCreatedCommandData>,
  "send"
>;

/** The getter throws until scim_membership registers, so an early delivery retries. */
export function recordMemberCreated(
  sender: () => ScimMemberCreatedSender,
): IntentExecutor<RecordMemberCreatedCommandData> {
  return async (fact) => {
    await sender().send(fact);
  };
}

/** The daily prune of delivered member-created facts. */
export function pruneMemberCreatedIntents(
  retention: Pick<ProcessStore, "deleteDispatchedBefore">,
): () => Promise<void> {
  return async () => {
    await retention.deleteDispatchedBefore({
      processName: SCIM_MEMBERSHIP_PROCESS_NAME,
      before: nowInstant().epochMilliseconds - SCIM_MEMBERSHIP_RETENTION_MS,
    });
  };
}

/**
 * What organization's audit intents do once the outbox delivers them: the record intent sends
 * organization's own command, so the audit fact lands as an event audit-log reacts to (§9).
 */
import type { EventingCommandSender, IntentExecutor, ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import { ORGANIZATION_AUDIT_PROCESS_NAME } from "../rules/organization-audit.rules.ts";
import type { RecordAuditCommandData } from "./organization-audit.commands.ts";
import { ORGANIZATION_AUDIT_RETENTION_MS } from "./organization-audit.process.ts";

export type OrganizationAuditSender = Pick<EventingCommandSender<RecordAuditCommandData>, "send">;

/** Sends the fact under the key its commit minted; an unconnected sender throws, so it retries. */
export function recordAuditFact(
  sender: () => OrganizationAuditSender | undefined,
): IntentExecutor<RecordAuditCommandData> {
  return async (fact) => {
    const connected = sender();
    if (!connected) throw new Error("organization_audit is not registered in this process");
    await connected.send(fact);
  };
}

/** The daily prune of delivered audit intents. */
export function pruneAuditIntents(
  retention: Pick<ProcessStore, "deleteDispatchedBefore">,
): () => Promise<void> {
  return async () => {
    await retention.deleteDispatchedBefore({
      processName: ORGANIZATION_AUDIT_PROCESS_NAME,
      before: nowInstant().epochMilliseconds - ORGANIZATION_AUDIT_RETENTION_MS,
    });
  };
}

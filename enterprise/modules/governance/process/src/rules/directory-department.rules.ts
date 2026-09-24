// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";

import { decideMatch, type OrganizationAccountIndex } from "./identity-evidence.rules.ts";

/** A string field off an event's `extra`, or "" for anything else. */
export function extraString(event: NormalizedPullEvent, field: string): string {
  const value = event.extra?.[field];
  return typeof value === "string" ? value : "";
}

/**
 * The one member a directory row proves, or null (main `directoryDepartmentSync.service.ts:271-305`).
 * Conflicting proof assigns nobody; an accepted link outranks the directory index (ADR-128 §12).
 */
export function provenUserId({
  row,
  accounts,
  openLinkUserId,
}: {
  row: NormalizedPullEvent;
  accounts: OrganizationAccountIndex;
  openLinkUserId: string | null;
}): string | null {
  const decision = decideMatch({
    identity: { rawActorId: row.actor, displayText: extraString(row, "mail"), openLinkUserId },
    accounts,
  });
  if (decision.outcome === "suspend") return null;

  if (openLinkUserId !== null) return openLinkUserId;

  const byDirectory = accounts.usersByDirectoryId.get(row.actor) ?? [];
  if (byDirectory.length === 1) return byDirectory[0] ?? null;
  if (byDirectory.length > 1) return null;

  return decision.outcome === "link" ? decision.userId : null;
}

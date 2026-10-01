// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A domain command the server accepted, while the read it changes has not
 * caught up. The projection settles a moment after the command does, so a
 * page that read once and stopped shows the row exactly as it was — which
 * reads as a press that did nothing, and the answer to that is to press
 * again (specs/identity/sso-domain-verification.feature).
 */
import type { DomainRow } from "./domain-rows.ts";

export type PendingDomainChange = {
  domain: string;
  /** Which command is waiting; each settles on a different fact. */
  kind: "proof" | "removal";
};

/** What the reader is told while the status catches up. */
export const PENDING_DOMAIN_WORDS: Record<PendingDomainChange["kind"], string> = {
  proof: "Proof accepted. Updating your domain status…",
  removal: "Removal accepted. Updating your domain status…",
};

/**
 * Whether the read now shows what the command did. A proof settles when the
 * domain reads as proved; a removal when the domain is gone from the rows
 * altogether — evidence, claim and all.
 */
export function pendingDomainSettled({
  pending,
  rows,
}: {
  pending: PendingDomainChange;
  rows: readonly DomainRow[];
}): boolean {
  const row = rows.find((candidate) => candidate.domain === pending.domain);

  if (pending.kind === "removal") return row === undefined;

  return row?.proved ?? false;
}

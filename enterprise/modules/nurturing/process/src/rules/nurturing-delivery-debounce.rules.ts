// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";

export type Debounce = Readonly<{ seconds: number; claimKey: string }>;

/** The tenant's trace, simulation, evaluation or coding update: main's CRM contract, five minutes. */
const TENANT_UPDATE_SECONDS = 5 * 60;
const TENANT_UPDATE_KINDS: ReadonlySet<NurturingSignal["kind"]> = new Set([
  "trace_received",
  "simulation_run_finished",
  "evaluation_completed",
  "coding_session_stored",
]);
/** An app open names the person as its tenant, so the hour is spent per person across pods. */
const PERSON_HOUR_SECONDS = 60 * 60;
const PERSON_HOUR_KINDS: ReadonlySet<NurturingSignal["kind"]> = new Set([
  "app_opened",
  "sessions_page_viewed",
]);

/** The window a Customer.io update waits out, or null for a kind that is never debounced. */
export function pickCustomerIoDebounce(signal: NurturingSignal): Debounce | null {
  if (TENANT_UPDATE_KINDS.has(signal.kind)) {
    // Main's key, unchanged for the kinds that existed before.
    return {
      seconds: TENANT_UPDATE_SECONDS,
      claimKey: `nurturing:cio-sync:${signal.kind}:${signal.tenantId}`,
    };
  }
  if (PERSON_HOUR_KINDS.has(signal.kind)) {
    return {
      seconds: PERSON_HOUR_SECONDS,
      claimKey: `nurturing:debounce:${signal.kind}:${signal.tenantId}`,
    };
  }
  return null;
}

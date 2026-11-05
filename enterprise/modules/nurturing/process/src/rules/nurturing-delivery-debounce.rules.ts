// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";

export type Debounce = Readonly<{ seconds: number; claimKey: string }>;

/** The tenant's trace, simulation, evaluation or coding update: main's CRM contract, 5 minutes. */
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
  "usage_page_opened",
]);
/** Sent for a person's first open only, so its claim outlives any account; Redis holds it. */
const PERSON_ONCE_SECONDS = 10 * 365 * 24 * 60 * 60;
const PERSON_ONCE_KINDS: ReadonlySet<NurturingSignal["kind"]> = new Set(["usage_page_viewed"]);

/**
 * One organization's window over its members, whichever project raised the fact: without it a busy
 * organization would send one member batch per project. A first trace shares the traces' window, as
 * they tell the same traits. A list or a count needs none: its claim is keyed by the value.
 */
export function pickOrganizationDebounce({
  signal,
  organizationId,
}: Readonly<{ signal: NurturingSignal; organizationId: string }>): Debounce | null {
  switch (signal.kind) {
    case "trace_received":
    case "first_trace_integrated":
      return {
        seconds: TENANT_UPDATE_SECONDS,
        claimKey: `nurturing:cio-sync-organization:traces:${organizationId}`,
      };
    case "coding_session_stored":
      return {
        seconds: TENANT_UPDATE_SECONDS,
        claimKey: `nurturing:cio-sync-organization:coding_session_stored:${organizationId}`,
      };
    default:
      return null;
  }
}

/** own_coding_first_session_at: first recorded across orgs, set once; claimed on the person. */
export function ownCodingFirstSessionClaim(
  signal: NurturingSignalOf<"own_coding_session_stored">,
): Debounce {
  return {
    seconds: PERSON_ONCE_SECONDS,
    claimKey: `nurturing:own_coding_first_session:${signal.userId}`,
  };
}

/** The window a Customer.io update waits out, or null for a kind that is never debounced. */
export function pickCustomerIoDebounce(signal: NurturingSignal): Debounce | null {
  if (signal.kind === "own_coding_session_stored") {
    // Keyed by the person, so their sessions from every organization share one window.
    return {
      seconds: TENANT_UPDATE_SECONDS,
      claimKey: `nurturing:cio-sync-person:own_coding_session_stored:${signal.userId}`,
    };
  }
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
  if (PERSON_ONCE_KINDS.has(signal.kind)) {
    return {
      seconds: PERSON_ONCE_SECONDS,
      claimKey: `nurturing:once:${signal.kind}:${signal.tenantId}`,
    };
  }
  return null;
}

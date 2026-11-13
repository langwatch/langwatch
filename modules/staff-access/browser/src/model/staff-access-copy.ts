/** The words the operator reads for each scope and status; one plain line per scope. */

import type {
  StaffAccessRequestStatus,
  StaffAccessScopeName,
} from "@langwatch/staff-access-contract";

export type ScopeCopy = { label: string; line: string };

export const SCOPE_COPY: Readonly<Record<StaffAccessScopeName, ScopeCopy>> = {
  "org:metadata": {
    label: "Organization metadata",
    line: "How the organization is set up and used: projects, settings, evaluators, prompts, costs and usage. No trace or dataset content.",
  },
  "org:content": {
    label: "Organization content",
    line: "Everything in metadata, plus the customer's traces, datasets, annotations, experiments and scenario runs.",
  },
  "org:support": {
    label: "Support changes",
    line: "Everything in metadata, plus creating and editing evaluators, prompts, datasets, scenarios, dashboards and triggers as LangWatch Support. Never members, keys or billing.",
  },
  "ops:read": {
    label: "Ops read",
    line: "Platform health and which organizations use which features. No customer content.",
  },
  "copy:source": {
    label: "Copy from this organization",
    line: "The server reads this organization's projects with their evaluators, monitors, prompts and datasets to copy them into the other organization named here. The agent gets no key to this organization and never sees its traces.",
  },
  "copy:target": {
    label: "Copy into this organization",
    line: "The server creates the copied projects, evaluators, paused monitors, prompts and datasets here, and nothing else. Never secrets, keys, members or billing.",
  },
};

export const STATUS_LABEL: Readonly<Record<StaffAccessRequestStatus, string>> = {
  pending: "Waiting for approval",
  approved: "Approved",
  denied: "Denied",
  redeemed: "Live",
  expired: "Expired",
  revoked: "Revoked",
};

export function scopeLabel(scope: StaffAccessScopeName): string {
  return SCOPE_COPY[scope].label;
}

/** Which way a copy side moves the setup, in the operator's words; null for any other request. */
export function copyDirection({
  scopes,
  organizationName,
  counterpartOrganizationName,
}: {
  scopes: readonly StaffAccessScopeName[];
  organizationName: string | null;
  counterpartOrganizationName: string | null;
}): string | null {
  const here = organizationName ?? "this organization";
  const other = counterpartOrganizationName ?? "the other organization";
  if (scopes.includes("copy:source")) return `From ${here} into ${other}`;
  if (scopes.includes("copy:target")) return `From ${other} into ${here}`;
  return null;
}

/**
 * The setup command the operator runs where the agent works, after copying the key. The key is
 * read from stdin, so it stays out of shell history, the process list and the agent's transcript.
 */
export const SETUP_COMMAND = "pbpaste | langwatch ops setup";

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
  "ops:copy": {
    label: "Organization copy",
    line: "Lets the agent copy projects with their evaluators, monitors, prompts and datasets between this organization and one other, each side approved on its own. Never secrets, keys, members or billing.",
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

/** The setup command the operator pastes on the machine the agent runs on. */
export function setupCommand(requesterKey: string): string {
  return `langwatch ops setup --requester-key ${requesterKey}`;
}
